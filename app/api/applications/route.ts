import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { APPLICATION_LIMITS, APPLICATION_TTL_MS, canonicalEmail, effectiveStatus, emailDomain, isDisposableEmail, isFreeEmailProvider, validateApplication, type ApplicationSignals } from "@/lib/applications";
import { checkStartToken } from "@/lib/server/application-token";
import { hashValue } from "@/lib/server/app-secret";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { lookupTeamForApplication } from "@/lib/server/first-team";
import { clientIp } from "@/lib/server/client-ip";
import { platformAuditDoc } from "@/lib/server/audit";
import { notifyPlatformOwnersOfApplication } from "@/lib/server/notify-platform-owners";
import { appBaseUrl, sendEmail } from "@/lib/server/email";
import { emailTemplates } from "@/lib/server/email-templates";
import { getRole } from "@/lib/roles";

const HOUR_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
/** Every request from one IP, valid or not, counts here, so bad requests can't be used to hammer the route. */
const ATTEMPTS_PER_IP_PER_HOUR = 40;

function fail(status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, code, error, ...extra }, { status });
}

/**
 * P20: submits an application to create a team account. Public in the sense that team creation stays disabled, but
 * the caller must be signed in with a **verified** email (Google sign-in, or a clicked verification link), and every
 * measure runs here, server-side: a body-size cap, the honeypot, the signed time-to-submit token, input
 * validation and sanitizing, the disposable-email list, blocks, Cloudflare Turnstile (when configured), per-IP
 * (hashed) and per-email rate limits, one pending application per applicant / email / team number, and a check that
 * no account already has this FTC team. Nothing is ever approved automatically: this only files the application.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return fail(401, "not-signed-in", "Sign in to apply.");
  if (decoded.email_verified !== true || !decoded.email) {
    return fail(403, "email-unverified", "Verify your email address before applying.");
  }

  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return fail(503, "not-configured", "Server isn't configured.");

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "too-large", "That's too much text.");
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return fail(413, "too-large", "That's too much text.");
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    body = null;
  }
  if (!body) return fail(400, "bad-request", "That request couldn't be read.");

  const nowMs = Date.now();
  const ip = clientIp(request);
  const ipKey = hashValue("ip", ip);

  const attempts = await consumeRateLimit(db, `attempt_${ipKey}`, ATTEMPTS_PER_IP_PER_HOUR, HOUR_MS, nowMs);
  if (!attempts.allowed) return fail(429, "rate-limited", "Too many requests from your network. Try again in a while.");

  // Honeypot: a field no human sees. Anything in it is a bot; it gets the same generic answer as any other refusal.
  if (typeof body.orgUrl === "string" && body.orgUrl.trim() !== "") return fail(400, "rejected", "We couldn't submit that. Please try again.");

  const token = checkStartToken(body.startToken, nowMs);
  if (!token.ok) {
    return token.reason === "too-fast"
      ? fail(400, "too-fast", "That was quick. Take a moment to check your answers, then submit again.")
      : fail(400, "form-expired", "This form has expired. Refresh the page and try again.");
  }

  const validated = validateApplication(body);
  if (!validated.ok) return fail(400, "invalid", "Check the highlighted fields.", { fields: validated.errors });
  const input = validated.value;

  const email = decoded.email;
  if (isDisposableEmail(email)) return fail(400, "disposable-email", "Disposable email addresses can't be used. Use your school, team or personal email.");
  const emailKey = hashValue("email", canonicalEmail(email));

  // Blocked by the platform owner (email or team number).
  const [emailBlock, teamBlock] = await Promise.all([db.collection("applicationBlocks").doc(`email_${emailKey}`).get(), db.collection("applicationBlocks").doc(`team_${input.teamNumber}`).get()]);
  if (emailBlock.exists || teamBlock.exists) return fail(403, "blocked", "We can't accept an application from this email or for this team.");

  const turnstile = await verifyTurnstile(body.turnstileToken, ip === "unknown" ? null : ip);
  if (turnstile.configured && !turnstile.ok) return fail(400, "captcha-failed", "The CAPTCHA check didn't pass. Reload it and try again.");

  const [ipLimit, emailLimit] = [
    await consumeRateLimit(db, `apply_ip_${ipKey}`, APPLICATION_LIMITS.perIpPerHour, HOUR_MS, nowMs),
    await consumeRateLimit(db, `apply_email_${emailKey}`, APPLICATION_LIMITS.perEmailPerHour, HOUR_MS, nowMs),
  ];
  if (!ipLimit.allowed || !emailLimit.allowed) return fail(429, "rate-limited", "You've applied several times recently. Try again in an hour.");

  // Already on a team?
  if ((await db.collection("users").doc(decoded.uid).get()).exists) return fail(409, "already-member", "You're already on a team account.");

  // One pending (not expired) application per applicant, email and team number.
  const pendingChecks = await Promise.all([
    db.collection("teamApplications").where("applicantUid", "==", decoded.uid).where("status", "==", "pending").get(),
    db.collection("teamApplications").where("emailKey", "==", emailKey).where("status", "==", "pending").get(),
    db.collection("teamApplications").where("teamNumber", "==", input.teamNumber).where("status", "==", "pending").get(),
  ]);
  const livePending = pendingChecks.some((snap) =>
    snap.docs.some((d) => {
      const expires = d.data().expiresAt;
      return effectiveStatus({ status: "pending", expiresAtMs: expires && typeof expires.toMillis === "function" ? expires.toMillis() : null }, nowMs) === "pending";
    })
  );
  if (livePending) return fail(409, "duplicate", "There's already a pending application for this person or this team.");

  // An account for this FTC team already exists: they should join it, not create another.
  const [byNumbers, byLegacy] = await Promise.all([
    db.collection("teams").where("fieldTeamNumbers", "array-contains", input.teamNumber).limit(1).get(),
    db.collection("teams").where("number", "==", input.teamNumber).limit(1).get(),
  ]);
  const existingAccountForNumber = !byNumbers.empty || !byLegacy.empty;
  if (existingAccountForNumber) {
    return fail(409, "account-exists", `An account for FTC ${input.teamNumber} already exists. Ask your team's admin for the join code instead.`);
  }

  const first = await lookupTeamForApplication(input.teamNumber, input.teamName);
  const authRecord = await adminAuth.getUser(decoded.uid).catch(() => null);
  const createdMs = authRecord?.metadata.creationTime ? new Date(authRecord.metadata.creationTime).getTime() : NaN;

  const signals: ApplicationSignals = {
    emailVerified: true,
    signInProvider: (decoded.firebase?.sign_in_provider as string | undefined) ?? null,
    accountAgeMs: Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : null,
    firstApi: { season: first.season, status: first.status, officialName: first.officialName, nameMatches: first.nameMatches },
    turnstile: turnstile.configured ? "passed" : "not-configured",
    fillSeconds: Math.round(token.ageMs / 1000),
    ipApplicationsLastHour: ipLimit.count,
    emailDomain: emailDomain(email),
    freeEmailProvider: isFreeEmailProvider(email),
    existingAccountForNumber,
  };

  const ref = db.collection("teamApplications").doc();
  const batch = db.batch();
  batch.set(ref, {
    applicantUid: decoded.uid,
    applicantName: input.name,
    applicantEmail: email,
    emailKey,
    teamNumber: input.teamNumber,
    teamName: input.teamName || first.officialName || "",
    officialTeamName: first.officialName,
    role: input.role,
    verification: input.verification,
    link: input.link,
    status: "pending",
    rejectionReason: null,
    decidedAt: null,
    decidedBy: null,
    teamId: null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(nowMs + APPLICATION_TTL_MS),
  });
  batch.set(db.collection("applicationPrivate").doc(ref.id), { signals, ipHash: ipKey, notes: "", createdAt: FieldValue.serverTimestamp() });
  batch.set(db.collection("platformAuditLog").doc(), platformAuditDoc("submit-application", { uid: decoded.uid, name: input.name }, { applicationId: ref.id, teamNumber: input.teamNumber }));
  await batch.commit();

  // Best effort from here: none of these can undo the filed application.
  await notifyPlatformOwnersOfApplication(db, {
    applicationId: ref.id,
    applicantName: input.name,
    applicantEmail: email,
    teamNumber: input.teamNumber,
    teamName: input.teamName || first.officialName || "",
    role: getRole(input.role).label,
  }).catch(() => {});
  await sendEmail(emailTemplates.applicationReceived({ to: email, name: input.name, teamNumber: input.teamNumber, statusUrl: `${appBaseUrl()}/apply` })).catch(() => {});

  return NextResponse.json({ ok: true, applicationId: ref.id });
}

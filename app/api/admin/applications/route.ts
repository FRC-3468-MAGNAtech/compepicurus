import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { APPLICATION_LIMITS, effectiveStatus, sanitizeLine, sanitizeText } from "@/lib/applications";
import { migratedFieldTeamId } from "@/lib/field-teams";
import { DEFAULT_ROLE_ID, type RoleId } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";
import { randomJoinCode } from "@/lib/server/team-settings";
import { platformAuditDoc, teamAuditDoc } from "@/lib/server/audit";
import { appBaseUrl, sendEmail } from "@/lib/server/email";
import { emailTemplates } from "@/lib/server/email-templates";

class RouteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function toMs(value: unknown): number | null {
  return value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function" ? (value as { toMillis: () => number }).toMillis() : null;
}

/**
 * P20: the platform owner's review actions on team applications. Every action requires a platform owner (verified
 * email in OWNER_EMAILS plus the claim) and is logged in `platformAuditLog`. Nothing here is automatic: approval
 * only happens when the platform owner presses it.
 *
 *  - approve: ONE transaction creates the team account (join code, `fieldTeams` with the applied team, `ownerUid` =
 *    the applicant), makes the applicant its owner and admin, marks the application approved and writes the audit
 *    entries. Refuses an expired or already-decided application, an applicant who has since joined a team, and an
 *    FTC number some account already has.
 *  - reject (with a reason the applicant sees), block (email and/or team number, which also ends the application),
 *    unblock, and private notes.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isPlatformOwnerToken(decoded)) return NextResponse.json({ ok: false, error: "Only the platform owner can do this." }, { status: 403 });

  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const actor = { uid: decoded.uid, name: sanitizeLine(decoded.name ?? decoded.email ?? "Platform owner", 80) };

  try {
    switch (action) {
      case "approve": {
        const applicationId = String(body?.applicationId ?? "");
        // The applicant must still exist and still have a verified email; checked outside the transaction (an Auth call).
        const appSnap = await db.collection("teamApplications").doc(applicationId).get();
        if (!appSnap.exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
        const applicantUid = String(appSnap.data()?.applicantUid ?? "");
        const applicant = await adminAuth.getUser(applicantUid).catch(() => null);
        if (!applicant) throw new RouteError(409, "applicant-gone", "The applicant's sign-in account no longer exists.");
        if (!applicant.emailVerified) throw new RouteError(409, "email-unverified", "The applicant's email isn't verified.");
        const result = await approve(db, applicationId, actor);
        await sendEmail(emailTemplates.applicationApproved({ to: result.email, name: result.name, teamNumber: result.teamNumber, appUrl: `${appBaseUrl()}/dashboard` })).catch(() => {});
        return NextResponse.json({ ok: true, teamId: result.teamId });
      }
      case "reject": {
        const reason = sanitizeText(body?.reason, APPLICATION_LIMITS.reason);
        if (reason.length < 3) throw new RouteError(400, "reason-required", "Give the applicant a reason (a sentence is fine).");
        const decided = await decide(db, String(body?.applicationId ?? ""), actor, "rejected", reason);
        await sendEmail(emailTemplates.applicationRejected({ to: decided.email, name: decided.name, teamNumber: decided.teamNumber, reason, statusUrl: `${appBaseUrl()}/apply` })).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "block": {
        const blockEmail = body?.blockEmail === true;
        const blockTeam = body?.blockTeam === true;
        if (!blockEmail && !blockTeam) throw new RouteError(400, "nothing-to-block", "Choose the email, the team number, or both to block.");
        const reason = sanitizeText(body?.reason, APPLICATION_LIMITS.reason);
        await decide(db, String(body?.applicationId ?? ""), actor, "blocked", reason, { blockEmail, blockTeam });
        return NextResponse.json({ ok: true });
      }
      case "unblock": {
        const blockId = String(body?.blockId ?? "");
        if (!/^(email_[0-9a-f]{32}|team_\d{1,5})$/.test(blockId)) throw new RouteError(400, "bad-block", "That isn't a block.");
        const batch = db.batch();
        batch.delete(db.collection("applicationBlocks").doc(blockId));
        batch.set(db.collection("platformAuditLog").doc(), platformAuditDoc("unblock", actor, { blockId }));
        await batch.commit();
        return NextResponse.json({ ok: true });
      }
      case "note": {
        const applicationId = String(body?.applicationId ?? "");
        const appRef = db.collection("applicationPrivate").doc(applicationId);
        if (!(await db.collection("teamApplications").doc(applicationId).get()).exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
        await appRef.set({ notes: sanitizeText(body?.notes, APPLICATION_LIMITS.notes), notesUpdatedAt: FieldValue.serverTimestamp(), notesUpdatedBy: actor.uid }, { merge: true });
        return NextResponse.json({ ok: true });
      }
      default:
        throw new RouteError(400, "unknown-action", "Unknown action.");
    }
  } catch (err) {
    if (err instanceof RouteError) return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: err.status });
    console.error("applications route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

type Actor = { uid: string; name: string };

async function approve(db: Firestore, applicationId: string, actor: Actor): Promise<{ teamId: string; email: string; name: string; teamNumber: number }> {
  return db.runTransaction(async (txn) => {
    const appRef = db.collection("teamApplications").doc(applicationId);
    const appSnap = await txn.get(appRef);
    if (!appSnap.exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
    const app = appSnap.data()!;
    const status = effectiveStatus({ status: app.status, expiresAtMs: toMs(app.expiresAt) }, Date.now());
    if (status === "expired") throw new RouteError(409, "expired", "This application has expired. Ask the applicant to apply again.");
    if (status !== "pending") throw new RouteError(409, "already-decided", `This application is already ${status}.`);

    const userRef = db.collection("users").doc(app.applicantUid);
    const [userSnap, numbersSnap, legacySnap] = await Promise.all([
      txn.get(userRef),
      txn.get(db.collection("teams").where("fieldTeamNumbers", "array-contains", app.teamNumber).limit(1)),
      txn.get(db.collection("teams").where("number", "==", app.teamNumber).limit(1)),
    ]);
    if (userSnap.exists) throw new RouteError(409, "already-member", "The applicant has already joined a team account.");
    if (!numbersSnap.empty || !legacySnap.empty) throw new RouteError(409, "account-exists", `An account for FTC ${app.teamNumber} already exists.`);

    const teamRef = db.collection("teams").doc();
    const fieldTeam = { id: migratedFieldTeamId(app.teamNumber), number: app.teamNumber, name: app.teamName || "" };
    const role: RoleId = (app.role as RoleId) ?? DEFAULT_ROLE_ID;

    txn.set(teamRef, {
      number: app.teamNumber,
      name: app.teamName || null,
      fieldTeams: [fieldTeam],
      fieldTeamIdList: [fieldTeam.id],
      fieldTeamNumbers: [app.teamNumber],
      ownerUid: app.applicantUid,
      joinCode: randomJoinCode(),
      activeEventCode: null,
      activeSeasonId: null,
      activeEvent: null,
      activeEventCodes: [],
      activeEvents: [],
      applicationId,
      createdAt: FieldValue.serverTimestamp(),
    });
    txn.set(userRef, {
      name: app.applicantName,
      email: app.applicantEmail,
      teamId: teamRef.id,
      primaryRole: role,
      secondaryRoles: [],
      isAdmin: true,
      isOwner: true, // mirror of teams.ownerUid
      fieldTeamIds: [fieldTeam.id],
      themeId: defaultThemeId,
      createdAt: FieldValue.serverTimestamp(),
    });
    txn.update(appRef, { status: "approved", decidedAt: FieldValue.serverTimestamp(), decidedBy: actor.uid, teamId: teamRef.id });
    // The new account's own log gets a minimal entry (no applicant details); the platform log gets the full one.
    txn.set(db.collection("auditLog").doc(), teamAuditDoc(teamRef.id, actor.uid, actor.name, "approve-team-application", { applicationId }, null, { ownerUid: app.applicantUid, teamNumber: app.teamNumber }));
    txn.set(db.collection("platformAuditLog").doc(), platformAuditDoc("approve-application", actor, { applicationId, teamId: teamRef.id, teamNumber: app.teamNumber, applicantUid: app.applicantUid }));
    return { teamId: teamRef.id, email: app.applicantEmail as string, name: app.applicantName as string, teamNumber: app.teamNumber as number };
  });
}

async function decide(
  db: Firestore,
  applicationId: string,
  actor: Actor,
  outcome: "rejected" | "blocked",
  reason: string,
  blocks: { blockEmail?: boolean; blockTeam?: boolean } = {}
): Promise<{ email: string; name: string; teamNumber: number }> {
  return db.runTransaction(async (txn) => {
    const appRef = db.collection("teamApplications").doc(applicationId);
    const snap = await txn.get(appRef);
    if (!snap.exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
    const app = snap.data()!;
    const status = effectiveStatus({ status: app.status, expiresAtMs: toMs(app.expiresAt) }, Date.now());
    if (status === "expired") throw new RouteError(409, "expired", "This application has expired.");
    if (status !== "pending") throw new RouteError(409, "already-decided", `This application is already ${status}.`);

    txn.update(appRef, { status: outcome, rejectionReason: reason || null, decidedAt: FieldValue.serverTimestamp(), decidedBy: actor.uid });
    if (outcome === "blocked") {
      const common = { reason: reason || null, applicationId, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid };
      if (blocks.blockEmail) txn.set(db.collection("applicationBlocks").doc(`email_${app.emailKey}`), { type: "email", value: app.applicantEmail, ...common });
      if (blocks.blockTeam) txn.set(db.collection("applicationBlocks").doc(`team_${app.teamNumber}`), { type: "team", value: String(app.teamNumber), ...common });
    }
    txn.set(
      db.collection("platformAuditLog").doc(),
      platformAuditDoc(outcome === "blocked" ? "block-application" : "reject-application", actor, {
        applicationId,
        teamNumber: app.teamNumber,
        reason: reason || null,
        // (Firestore refuses `undefined` values, so the key is only present for a block.)
        ...(outcome === "blocked" ? { blocked: { email: blocks.blockEmail === true, team: blocks.blockTeam === true } } : {}),
      })
    );
    return { email: app.applicantEmail as string, name: app.applicantName as string, teamNumber: app.teamNumber as number };
  });
}

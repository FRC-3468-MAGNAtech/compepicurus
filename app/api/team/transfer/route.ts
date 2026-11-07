import { NextResponse } from "next/server";
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { teamAuditDoc, platformAuditDoc } from "@/lib/server/audit";
import { appBaseUrl, sendEmail } from "@/lib/server/email";
import { emailTemplates } from "@/lib/server/email-templates";
import { sanitizeLine, sanitizeText } from "@/lib/applications";
import { fieldTeamLabel, readFieldTeams } from "@/lib/field-teams";
import { TRANSFER_TTL_MS, canCancelTransfer, checkTransferRequest, checkTransferResponse, confirmationMatches, isRecentSignIn, isTeamOwner, readPendingTransfer } from "@/lib/team-owner";

class RouteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const teamLabelOf = (team: DocumentData) => {
  const teams = readFieldTeams(team);
  return teams.length > 0 ? teams.map(fieldTeamLabel).join(" / ") : "your team";
};

/**
 * P20: team ownership transfer. Every change to `teams.ownerUid` / `pendingTransfer` happens here (Admin SDK;
 * firestore.rules refuses both from any client), in transactions that re-check the state they depend on.
 *
 *  - request: the team owner picks an existing **admin with a verified email**, re-authenticates (a sign-in no
 *    older than 5 minutes, read from the token's `auth_time`) and types an FTC team number. That creates one
 *    pending transfer that expires after 7 days.
 *  - accept: the recipient takes ownership. `ownerUid` changes in one transaction; the previous owner stays an
 *    **admin** but loses the owner protections; the new owner gets them. Nothing re-asserts the old owner later
 *    (sync-roles only ever fills in an account that has no owner at all).
 *  - decline (the recipient) / cancel (the owner or whoever requested it).
 *  - force: a platform owner can transfer any account for recovery (needs a reason, a re-authentication and the
 *    typed team number; logged in that account's audit log, clearly labelled, and in the platform log).
 * Expiry is lazy: an expired transfer can't be accepted and a new request simply replaces it.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";

  try {
    if (action === "force") return await forceTransfer(db, decoded, body ?? {});

    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const teamId = userSnap.exists ? (userSnap.data()?.teamId as string | undefined) : undefined;
    if (!userSnap.exists || !teamId) throw new RouteError(403, "no-team", "You're not on a team account.");
    const user = userSnap.data()!;
    const teamRef = db.collection("teams").doc(teamId);

    switch (action) {
      case "request":
        return await requestTransfer(db, decoded, user, teamId, body ?? {});
      case "accept":
      case "decline":
        return await respond(db, decoded, user, teamRef, action);
      case "cancel":
        return await cancel(db, decoded, user, teamRef);
      default:
        throw new RouteError(400, "unknown-action", "Unknown action.");
    }
  } catch (err) {
    if (err instanceof RouteError) return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: err.status });
    console.error("transfer route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

type Decoded = NonNullable<Awaited<ReturnType<typeof verifyBearerToken>>>;

async function requestTransfer(db: Firestore, decoded: Decoded, user: DocumentData, teamId: string, body: Record<string, unknown>) {
  const adminAuth = getAdminAuth()!;
  const teamRef = db.collection("teams").doc(teamId);
  const toUid = typeof body.toUid === "string" ? body.toUid : "";
  const targetSnap = toUid ? await db.collection("users").doc(toUid).get() : null;
  const targetData = targetSnap?.exists && targetSnap.data()?.teamId === teamId ? targetSnap.data()! : null;
  const targetAuth = targetData ? await adminAuth.getUser(toUid).catch(() => null) : null;

  const nowMs = Date.now();
  const pending = await db.runTransaction(async (txn) => {
    const teamSnap = await txn.get(teamRef);
    if (!teamSnap.exists) throw new RouteError(404, "no-team", "Team not found.");
    const team = teamSnap.data()!;
    const check = checkTransferRequest({
      actorUid: decoded.uid,
      actorIsOwner: isTeamOwner(team, decoded.uid, user.isOwner === true),
      pending: team.pendingTransfer,
      teamNumbers: readFieldTeams(team).map((t) => t.number),
      typedNumber: typeof body.confirm === "string" ? body.confirm : "",
      authTimeSeconds: decoded.auth_time,
      nowMs,
      target: targetData && targetAuth ? { uid: toUid, isAdmin: targetData.isAdmin === true, emailVerified: targetAuth.emailVerified } : null,
    });
    if (!check.ok) throw new RouteError(check.code === "reauth-required" ? 401 : check.code === "not-owner" ? 403 : 400, check.code, check.message);

    const id = db.collection("teamTransfers").doc().id;
    const record = {
      id,
      fromUid: decoded.uid,
      fromName: sanitizeLine(user.name ?? "", 80),
      toUid,
      toName: sanitizeLine(targetData!.name ?? "", 80),
      requestedAt: Timestamp.fromMillis(nowMs),
      expiresAt: Timestamp.fromMillis(nowMs + TRANSFER_TTL_MS),
    };
    txn.update(teamRef, { pendingTransfer: record });
    txn.set(db.collection("auditLog").doc(), teamAuditDoc(teamId, decoded.uid, record.fromName, "request-ownership-transfer", { targetUid: toUid, targetName: record.toName }, null, { expiresAt: record.expiresAt }));
    return { record, team };
  });

  await sendEmail(
    emailTemplates.ownershipTransferRequested({
      to: targetAuth!.email ?? targetData!.email,
      toName: pending.record.toName,
      fromName: pending.record.fromName,
      teamLabel: teamLabelOf(pending.team),
      expiresInDays: 7,
      appUrl: `${appBaseUrl()}/team-settings`,
    })
  ).catch(() => {});
  return NextResponse.json({ ok: true, transferId: pending.record.id });
}

async function respond(db: Firestore, decoded: Decoded, user: DocumentData, teamRef: DocumentReference, action: "accept" | "decline") {
  const adminAuth = getAdminAuth()!;
  const authRecord = await adminAuth.getUser(decoded.uid).catch(() => null);
  const nowMs = Date.now();

  const outcome = await db.runTransaction(async (txn) => {
    const teamSnap = await txn.get(teamRef);
    if (!teamSnap.exists) throw new RouteError(404, "no-team", "Team not found.");
    const team = teamSnap.data()!;
    const check = checkTransferResponse({
      pending: team.pendingTransfer,
      uid: decoded.uid,
      nowMs,
      recipient: { isAdmin: user.isAdmin === true, emailVerified: authRecord?.emailVerified === true },
      forAccept: action === "accept",
    });
    if (!check.ok) throw new RouteError(check.code === "not-recipient" ? 403 : 409, check.code, check.message);
    const pending = readPendingTransfer(team.pendingTransfer)!;
    const myName = sanitizeLine(user.name ?? "", 80);

    if (action === "decline") {
      txn.update(teamRef, { pendingTransfer: FieldValue.delete() });
      txn.set(db.collection("auditLog").doc(), teamAuditDoc(teamRef.id, decoded.uid, myName, "decline-ownership-transfer", { fromUid: pending.fromUid, fromName: pending.fromName }, null, null));
      return { kind: "declined" as const };
    }

    // The request is only valid while the person who made it is still the owner (a forced recovery transfer in between voids it).
    const currentOwner = typeof team.ownerUid === "string" && team.ownerUid ? team.ownerUid : pending.fromUid;
    const oldOwnerRef = db.collection("users").doc(currentOwner);
    const oldOwnerSnap = await txn.get(oldOwnerRef);
    if (currentOwner !== pending.fromUid) {
      txn.update(teamRef, { pendingTransfer: FieldValue.delete() });
      throw new RouteError(409, "stale", "This request is no longer valid because the account's owner changed.");
    }

    txn.update(teamRef, { ownerUid: decoded.uid, pendingTransfer: FieldValue.delete() });
    txn.update(db.collection("users").doc(decoded.uid), { isOwner: true, isAdmin: true });
    if (oldOwnerSnap.exists && currentOwner !== decoded.uid) txn.update(oldOwnerRef, { isOwner: false }); // stays an admin
    txn.set(
      db.collection("auditLog").doc(),
      teamAuditDoc(teamRef.id, decoded.uid, myName, "transfer-ownership", { fromUid: currentOwner, fromName: pending.fromName, toUid: decoded.uid, toName: myName }, { ownerUid: currentOwner }, { ownerUid: decoded.uid })
    );
    return { kind: "accepted" as const, team, pending, oldOwnerEmail: oldOwnerSnap.exists ? (oldOwnerSnap.data()?.email as string | undefined) : undefined, myName };
  });

  if (outcome.kind === "accepted" && outcome.oldOwnerEmail) {
    await sendEmail(
      emailTemplates.ownershipTransferred({ to: outcome.oldOwnerEmail, name: outcome.pending.fromName, teamLabel: teamLabelOf(outcome.team), newOwnerName: outcome.myName, forced: false, appUrl: `${appBaseUrl()}/team-settings` })
    ).catch(() => {});
  }
  return NextResponse.json({ ok: true, result: outcome.kind });
}

async function cancel(db: Firestore, decoded: Decoded, user: DocumentData, teamRef: DocumentReference) {
  await db.runTransaction(async (txn) => {
    const teamSnap = await txn.get(teamRef);
    if (!teamSnap.exists) throw new RouteError(404, "no-team", "Team not found.");
    const team = teamSnap.data()!;
    const pending = readPendingTransfer(team.pendingTransfer);
    if (!pending) throw new RouteError(409, "no-pending", "There's no pending transfer.");
    if (!canCancelTransfer(pending, decoded.uid, isTeamOwner(team, decoded.uid, user.isOwner === true))) {
      throw new RouteError(403, "not-allowed", "Only the owner, or whoever requested the transfer, can cancel it.");
    }
    txn.update(teamRef, { pendingTransfer: FieldValue.delete() });
    txn.set(db.collection("auditLog").doc(), teamAuditDoc(teamRef.id, decoded.uid, sanitizeLine(user.name ?? "", 80), "cancel-ownership-transfer", { toUid: pending.toUid, toName: pending.toName }, null, null));
  });
  return NextResponse.json({ ok: true });
}

async function forceTransfer(db: Firestore, decoded: Decoded, body: Record<string, unknown>) {
  if (!isPlatformOwnerToken(decoded)) throw new RouteError(403, "not-platform-owner", "Only the platform owner can force a transfer.");
  if (!isRecentSignIn(decoded.auth_time, Date.now())) throw new RouteError(401, "reauth-required", "Confirm it's you: sign in again, then retry.");
  const adminAuth = getAdminAuth()!;
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const toUid = typeof body.toUid === "string" ? body.toUid : "";
  const reason = sanitizeText(body.reason, 500);
  if (reason.length < 3) throw new RouteError(400, "reason-required", "Give a reason for the recovery transfer.");
  if (!teamId || !toUid) throw new RouteError(400, "bad-request", "Choose an account and a new owner.");

  const teamRef = db.collection("teams").doc(teamId);
  const targetAuth = await adminAuth.getUser(toUid).catch(() => null);
  const actor = { uid: decoded.uid, name: sanitizeLine(decoded.name ?? decoded.email ?? "Platform owner", 80) };

  const done = await db.runTransaction(async (txn) => {
    const teamSnap = await txn.get(teamRef);
    if (!teamSnap.exists) throw new RouteError(404, "no-team", "That account doesn't exist.");
    const team = teamSnap.data()!;
    if (!confirmationMatches(typeof body.confirm === "string" ? body.confirm : "", readFieldTeams(team).map((t) => t.number))) {
      throw new RouteError(400, "bad-confirmation", "Type one of this account's FTC team numbers exactly to confirm.");
    }
    const targetRef = db.collection("users").doc(toUid);
    const oldOwnerUid = typeof team.ownerUid === "string" && team.ownerUid ? team.ownerUid : null;
    const [targetSnap, oldSnap] = await Promise.all([txn.get(targetRef), oldOwnerUid && oldOwnerUid !== toUid ? txn.get(db.collection("users").doc(oldOwnerUid)) : Promise.resolve(null)]);
    if (!targetSnap.exists || targetSnap.data()?.teamId !== teamId) throw new RouteError(400, "no-target", "The new owner must be a member of that account.");
    if (!targetAuth?.emailVerified) throw new RouteError(400, "unverified-email", "The new owner hasn't verified their email.");
    if (oldOwnerUid === toUid) throw new RouteError(400, "self", "They already own this account.");

    txn.update(teamRef, { ownerUid: toUid, pendingTransfer: FieldValue.delete() }); // a pending request from the old owner is void
    txn.update(targetRef, { isOwner: true, isAdmin: true });
    if (oldSnap?.exists && oldOwnerUid) txn.update(db.collection("users").doc(oldOwnerUid), { isOwner: false });
    const newName = sanitizeLine(targetSnap.data()?.name ?? "", 80);
    txn.set(
      db.collection("auditLog").doc(),
      teamAuditDoc(teamId, actor.uid, `${actor.name} (platform owner, recovery)`, "force-transfer-ownership", { toUid, toName: newName, reason }, { ownerUid: oldOwnerUid }, { ownerUid: toUid })
    );
    txn.set(db.collection("platformAuditLog").doc(), platformAuditDoc("force-transfer-ownership", actor, { teamId, toUid, fromUid: oldOwnerUid, reason }));
    return { team, newName, oldEmail: oldSnap?.exists ? (oldSnap.data()?.email as string | undefined) : undefined, oldName: oldSnap?.exists ? (oldSnap.data()?.name as string | undefined) : undefined };
  });

  const label = teamLabelOf(done.team);
  if (targetAuth?.email) await sendEmail(emailTemplates.ownershipTransferred({ to: targetAuth.email, name: done.newName, teamLabel: label, newOwnerName: done.newName, forced: true, appUrl: `${appBaseUrl()}/team-settings` })).catch(() => {});
  if (done.oldEmail) await sendEmail(emailTemplates.ownershipTransferred({ to: done.oldEmail, name: done.oldName ?? "", teamLabel: label, newOwnerName: done.newName, forced: true, appUrl: `${appBaseUrl()}/team-settings` })).catch(() => {});
  return NextResponse.json({ ok: true });
}


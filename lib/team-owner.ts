// P20: the two kinds of owner, as pure logic (no React, no Firebase) shared by the server routes, the UI and the tests.
//
//   Platform owner: an email in the server-only OWNER_EMAILS (verified). Approves team applications, switches team
//                   creation on/off, and can force-transfer an account for recovery. Carried as the `platformOwner`
//                   custom claim (+ the `users.isPlatformOwner` mirror for the UI). Always an admin of their own account.
//   Team owner:     `teams/{teamId}.ownerUid`: the one owner *inside* a team account. This is what the FIX2 protections,
//                   the "Owner" badge and ownership transfer follow. `users.isOwner` is a mirror of it that only the
//                   server routes write, in the same transaction as `ownerUid`, so the UI can read it from the roster.

export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A transfer needs a sign-in no older than this (the client re-authenticates first; the server checks the token's auth_time). */
export const REAUTH_MAX_AGE_SECONDS = 5 * 60;

/** Who owns the account: `ownerUid` once it is set; until then (an account the bootstrap hasn't reached) the legacy per-user flag. */
export function isTeamOwner(team: { ownerUid?: unknown } | null | undefined, uid: string, legacyOwnerFlag: boolean): boolean {
  if (team && typeof team.ownerUid === "string" && team.ownerUid) return team.ownerUid === uid;
  return legacyOwnerFlag;
}

export type OwnerCandidate = { uid: string; isOwner: boolean; createdAtMs: number };

/**
 * The bootstrap: pick the team owner for an account that has none yet. The user(s) already carrying the legacy
 * `isOwner` flag win (the earliest-created one if several; the rest are returned in `demoteUids`, they stay admins
 * but are no longer owners). Otherwise a signing-in platform owner of that account takes it. Otherwise nobody (an
 * ownerless account stays that way until a platform owner signs in or recovers it).
 *
 * This only ever runs when `ownerUid` is absent, which is what makes it impossible to reclaim ownership after a transfer.
 */
export function chooseBootstrapOwner(input: { users: readonly OwnerCandidate[]; caller: { uid: string; isPlatformOwner: boolean } }): { ownerUid: string | null; demoteUids: string[] } {
  const flagged = input.users.filter((u) => u.isOwner).sort((a, b) => a.createdAtMs - b.createdAtMs || a.uid.localeCompare(b.uid));
  if (flagged.length > 0) return { ownerUid: flagged[0].uid, demoteUids: flagged.slice(1).map((u) => u.uid) };
  if (input.caller.isPlatformOwner && input.users.some((u) => u.uid === input.caller.uid)) return { ownerUid: input.caller.uid, demoteUids: [] };
  return { ownerUid: null, demoteUids: [] };
}

export type PendingTransfer = {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  requestedAtMs: number;
  expiresAtMs: number;
};

function ms(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return null;
}

/** Reads `teams.pendingTransfer` (Timestamps or numbers) into a plain shape; `null` when absent or malformed. */
export function readPendingTransfer(raw: unknown): PendingTransfer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const requestedAtMs = ms(r.requestedAt);
  const expiresAtMs = ms(r.expiresAt);
  if (typeof r.id !== "string" || typeof r.fromUid !== "string" || typeof r.toUid !== "string" || requestedAtMs === null || expiresAtMs === null) return null;
  return {
    id: r.id,
    fromUid: r.fromUid,
    fromName: typeof r.fromName === "string" ? r.fromName : "",
    toUid: r.toUid,
    toName: typeof r.toName === "string" ? r.toName : "",
    requestedAtMs,
    expiresAtMs,
  };
}

/** A pending transfer that hasn't expired yet (expiry is lazy: after 7 days it simply stops counting). */
export function livePendingTransfer(raw: unknown, nowMs: number): PendingTransfer | null {
  const pending = readPendingTransfer(raw);
  return pending && pending.expiresAtMs > nowMs ? pending : null;
}

export type TransferFailure =
  | "not-owner"
  | "no-target"
  | "self"
  | "not-admin"
  | "unverified-email"
  | "bad-confirmation"
  | "reauth-required"
  | "pending-exists";

export const TRANSFER_FAILURE_MESSAGE: Record<TransferFailure, string> = {
  "not-owner": "Only the team owner can transfer ownership.",
  "no-target": "Choose a member of this team.",
  self: "You already own this team.",
  "not-admin": "Ownership can only go to an admin. Make them an admin in Team Management first.",
  "unverified-email": "That member hasn't verified their email yet, so they can't take ownership.",
  "bad-confirmation": "Type one of this account's FTC team numbers exactly to confirm.",
  "reauth-required": "Confirm it's you: sign in again, then retry.",
  "pending-exists": "There's already a pending transfer. Cancel it first.",
};

/** Does what the owner typed match one of the account's FTC team numbers? */
export function confirmationMatches(typed: string, teamNumbers: readonly number[]): boolean {
  const t = typed.trim();
  return /^\d{1,5}$/.test(t) && teamNumbers.includes(Number(t));
}

/** Is this sign-in recent enough for a sensitive action? `authTimeSeconds` is the ID token's `auth_time`. */
export function isRecentSignIn(authTimeSeconds: number | undefined, nowMs: number, maxAgeSeconds = REAUTH_MAX_AGE_SECONDS): boolean {
  return typeof authTimeSeconds === "number" && nowMs / 1000 - authTimeSeconds <= maxAgeSeconds && authTimeSeconds <= nowMs / 1000 + 60;
}

/** Every rule for starting a transfer, in one place, so the server route and the tests agree. First failure wins. */
export function checkTransferRequest(input: {
  actorUid: string;
  actorIsOwner: boolean;
  pending: unknown;
  teamNumbers: readonly number[];
  typedNumber: string;
  authTimeSeconds: number | undefined;
  nowMs: number;
  target: { uid: string; isAdmin: boolean; emailVerified: boolean } | null;
}): { ok: true } | { ok: false; code: TransferFailure; message: string } {
  const fail = (code: TransferFailure) => ({ ok: false as const, code, message: TRANSFER_FAILURE_MESSAGE[code] });
  if (!input.actorIsOwner) return fail("not-owner");
  if (!input.target) return fail("no-target");
  if (input.target.uid === input.actorUid) return fail("self");
  if (!input.target.isAdmin) return fail("not-admin");
  if (!input.target.emailVerified) return fail("unverified-email");
  if (!confirmationMatches(input.typedNumber, input.teamNumbers)) return fail("bad-confirmation");
  if (!isRecentSignIn(input.authTimeSeconds, input.nowMs)) return fail("reauth-required");
  if (livePendingTransfer(input.pending, input.nowMs)) return fail("pending-exists");
  return { ok: true };
}

export type TransferResponseFailure = "no-pending" | "expired" | "not-recipient" | "recipient-not-admin" | "unverified-email";

/** Can this person accept (or decline) the pending transfer right now? */
export function checkTransferResponse(input: {
  pending: unknown;
  uid: string;
  nowMs: number;
  recipient: { isAdmin: boolean; emailVerified: boolean };
  forAccept: boolean;
}): { ok: true } | { ok: false; code: TransferResponseFailure; message: string } {
  const pending = readPendingTransfer(input.pending);
  if (!pending) return { ok: false, code: "no-pending", message: "There's no pending transfer." };
  if (pending.expiresAtMs <= input.nowMs) return { ok: false, code: "expired", message: "This transfer has expired. Ask the owner to send a new one." };
  if (pending.toUid !== input.uid) return { ok: false, code: "not-recipient", message: "This transfer isn't addressed to you." };
  if (input.forAccept) {
    if (!input.recipient.isAdmin) return { ok: false, code: "recipient-not-admin", message: "You need to be an admin to accept ownership." };
    if (!input.recipient.emailVerified) return { ok: false, code: "unverified-email", message: "Verify your email first, then accept." };
  }
  return { ok: true };
}

/** Who may cancel a pending transfer: the current owner, or the person who requested it. */
export function canCancelTransfer(pending: PendingTransfer | null, uid: string, isOwner: boolean): boolean {
  return pending !== null && (isOwner || pending.fromUid === uid);
}

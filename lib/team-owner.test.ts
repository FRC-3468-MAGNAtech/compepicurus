import { describe, expect, it } from "vitest";
import {
  REAUTH_MAX_AGE_SECONDS,
  TRANSFER_TTL_MS,
  canCancelTransfer,
  checkTransferRequest,
  checkTransferResponse,
  chooseBootstrapOwner,
  confirmationMatches,
  isRecentSignIn,
  isTeamOwner,
  livePendingTransfer,
  readPendingTransfer,
} from "./team-owner";

const NOW = 1_800_000_000_000;

describe("isTeamOwner", () => {
  it("follows ownerUid once it is set, ignoring the legacy flag", () => {
    expect(isTeamOwner({ ownerUid: "u1" }, "u1", false)).toBe(true);
    expect(isTeamOwner({ ownerUid: "u1" }, "u2", true)).toBe(false); // a stale legacy flag never makes you owner
  });
  it("falls back to the legacy flag only while there is no ownerUid", () => {
    expect(isTeamOwner({}, "u2", true)).toBe(true);
    expect(isTeamOwner(null, "u2", false)).toBe(false);
    expect(isTeamOwner({ ownerUid: "" }, "u2", true)).toBe(true);
  });
});

describe("chooseBootstrapOwner", () => {
  const user = (uid: string, isOwner: boolean, createdAtMs: number) => ({ uid, isOwner, createdAtMs });
  it("keeps the existing owner (the one already flagged)", () => {
    expect(chooseBootstrapOwner({ users: [user("a", false, 1), user("me", true, 2)], caller: { uid: "a", isPlatformOwner: false } })).toEqual({ ownerUid: "me", demoteUids: [] });
  });
  it("picks the earliest-created when several are flagged, and demotes the rest", () => {
    expect(chooseBootstrapOwner({ users: [user("b", true, 5), user("a", true, 3), user("c", true, 3)], caller: { uid: "b", isPlatformOwner: true } })).toEqual({ ownerUid: "a", demoteUids: ["c", "b"] });
  });
  it("gives a signing-in platform owner an ownerless account, but not anyone else", () => {
    expect(chooseBootstrapOwner({ users: [user("p", false, 1), user("x", false, 2)], caller: { uid: "p", isPlatformOwner: true } }).ownerUid).toBe("p");
    expect(chooseBootstrapOwner({ users: [user("p", false, 1), user("x", false, 2)], caller: { uid: "x", isPlatformOwner: false } }).ownerUid).toBeNull();
    // a platform owner who isn't on this account can't take it
    expect(chooseBootstrapOwner({ users: [user("x", false, 2)], caller: { uid: "p", isPlatformOwner: true } }).ownerUid).toBeNull();
  });
});

describe("pending transfers", () => {
  const raw = { id: "t1", fromUid: "o", fromName: "Owen", toUid: "a", toName: "Ada", requestedAt: NOW, expiresAt: NOW + TRANSFER_TTL_MS };
  it("reads Timestamps or numbers and rejects malformed data", () => {
    expect(readPendingTransfer(raw)?.toUid).toBe("a");
    expect(readPendingTransfer({ ...raw, requestedAt: { toMillis: () => NOW }, expiresAt: { toMillis: () => NOW + 5 } })?.expiresAtMs).toBe(NOW + 5);
    expect(readPendingTransfer({ id: "t1" })).toBeNull();
    expect(readPendingTransfer(null)).toBeNull();
  });
  it("expires after 7 days (lazily)", () => {
    expect(TRANSFER_TTL_MS).toBe(7 * 86_400_000);
    expect(livePendingTransfer(raw, NOW + TRANSFER_TTL_MS - 1)).not.toBeNull();
    expect(livePendingTransfer(raw, NOW + TRANSFER_TTL_MS)).toBeNull();
  });
  it("lets the owner or the requester cancel, and nobody else", () => {
    const p = readPendingTransfer(raw)!;
    expect(canCancelTransfer(p, "o", true)).toBe(true);
    expect(canCancelTransfer(p, "o", false)).toBe(true); // the requester, even if no longer owner
    expect(canCancelTransfer(p, "z", false)).toBe(false);
    expect(canCancelTransfer(null, "o", true)).toBe(false);
  });
});

describe("confirmation and re-authentication", () => {
  it("accepts exactly one of the account's team numbers", () => {
    expect(confirmationMatches(" 35792 ", [35792, 35794])).toBe(true);
    expect(confirmationMatches("35794", [35792, 35794])).toBe(true);
    for (const bad of ["", "3579", "35792x", "035792", "35 792"]) expect(confirmationMatches(bad, [35792, 35794])).toBe(false);
  });
  it("needs a sign-in within five minutes", () => {
    const s = NOW / 1000;
    expect(isRecentSignIn(s - 10, NOW)).toBe(true);
    expect(isRecentSignIn(s - REAUTH_MAX_AGE_SECONDS, NOW)).toBe(true);
    expect(isRecentSignIn(s - REAUTH_MAX_AGE_SECONDS - 1, NOW)).toBe(false);
    expect(isRecentSignIn(undefined, NOW)).toBe(false);
    expect(isRecentSignIn(s + 3600, NOW)).toBe(false); // a timestamp from the future is not "recent"
  });
});

describe("checkTransferRequest", () => {
  const ok = {
    actorUid: "o",
    actorIsOwner: true,
    pending: undefined as unknown,
    teamNumbers: [35792],
    typedNumber: "35792",
    authTimeSeconds: NOW / 1000 - 30,
    nowMs: NOW,
    target: { uid: "a", isAdmin: true, emailVerified: true },
  };
  it("passes the happy path", () => expect(checkTransferRequest(ok)).toEqual({ ok: true }));
  it("rejects a non-owner first", () => expect(checkTransferRequest({ ...ok, actorIsOwner: false })).toMatchObject({ ok: false, code: "not-owner" }));
  it("needs a target who is another admin with a verified email", () => {
    expect(checkTransferRequest({ ...ok, target: null })).toMatchObject({ code: "no-target" });
    expect(checkTransferRequest({ ...ok, target: { ...ok.target, uid: "o" } })).toMatchObject({ code: "self" });
    expect(checkTransferRequest({ ...ok, target: { ...ok.target, isAdmin: false } })).toMatchObject({ code: "not-admin" });
    expect(checkTransferRequest({ ...ok, target: { ...ok.target, emailVerified: false } })).toMatchObject({ code: "unverified-email" });
  });
  it("needs the typed number and a fresh sign-in", () => {
    expect(checkTransferRequest({ ...ok, typedNumber: "1" })).toMatchObject({ code: "bad-confirmation" });
    expect(checkTransferRequest({ ...ok, authTimeSeconds: NOW / 1000 - 3600 })).toMatchObject({ code: "reauth-required" });
  });
  it("refuses a second live transfer but allows one over an expired transfer", () => {
    const live = { id: "t", fromUid: "o", toUid: "a", requestedAt: NOW - 1000, expiresAt: NOW + 1000 };
    expect(checkTransferRequest({ ...ok, pending: live })).toMatchObject({ code: "pending-exists" });
    expect(checkTransferRequest({ ...ok, pending: { ...live, expiresAt: NOW - 1 } })).toEqual({ ok: true });
  });
});

describe("checkTransferResponse", () => {
  const pending = { id: "t", fromUid: "o", toUid: "a", requestedAt: NOW - 1000, expiresAt: NOW + 1000 };
  const input = { pending, uid: "a", nowMs: NOW, recipient: { isAdmin: true, emailVerified: true }, forAccept: true };
  it("lets the recipient accept or decline", () => {
    expect(checkTransferResponse(input)).toEqual({ ok: true });
    expect(checkTransferResponse({ ...input, forAccept: false, recipient: { isAdmin: false, emailVerified: false } })).toEqual({ ok: true });
  });
  it("blocks anyone else, an expired transfer, and none at all", () => {
    expect(checkTransferResponse({ ...input, uid: "z" })).toMatchObject({ code: "not-recipient" });
    expect(checkTransferResponse({ ...input, nowMs: NOW + 1000 })).toMatchObject({ code: "expired" });
    expect(checkTransferResponse({ ...input, pending: undefined })).toMatchObject({ code: "no-pending" });
  });
  it("makes the recipient still an admin with a verified email to accept (not to decline)", () => {
    expect(checkTransferResponse({ ...input, recipient: { isAdmin: false, emailVerified: true } })).toMatchObject({ code: "recipient-not-admin" });
    expect(checkTransferResponse({ ...input, recipient: { isAdmin: true, emailVerified: false } })).toMatchObject({ code: "unverified-email" });
  });
});

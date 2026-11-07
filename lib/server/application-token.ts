import "server-only";
import { randomBytes } from "node:crypto";
import { APPLICATION_LIMITS } from "@/lib/applications";
import { getServerSecret, safeEqual, signValue } from "@/lib/server/app-secret";

// P20: the "minimum time-to-submit" check can't trust a timestamp the browser sends, so the server issues a signed
// start token when the form opens and checks its age on submit. A bot that submits instantly (or replays a token
// older than the maximum) is refused; a human who took 4 seconds to 2 hours is fine. The token carries no user data.

export function issueStartToken(nowMs: number = Date.now(), secret: string = getServerSecret()): string {
  const payload = `${nowMs}.${randomBytes(6).toString("hex")}`;
  return `${payload}.${signValue(payload, secret)}`;
}

export type StartTokenResult = { ok: true; ageMs: number } | { ok: false; reason: "missing" | "invalid" | "too-fast" | "expired" };

export function checkStartToken(token: unknown, nowMs: number = Date.now(), secret: string = getServerSecret()): StartTokenResult {
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const [issued, nonce, signature] = parts;
  if (!safeEqual(signature, signValue(`${issued}.${nonce}`, secret))) return { ok: false, reason: "invalid" };
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: "invalid" };
  const ageMs = nowMs - issuedAt;
  if (ageMs < APPLICATION_LIMITS.minFillMs) return { ok: false, reason: "too-fast" };
  if (ageMs > APPLICATION_LIMITS.maxFillMs) return { ok: false, reason: "expired" };
  return { ok: true, ageMs };
}

import "server-only";
import type { Firestore } from "firebase-admin/firestore";

/**
 * P20: a fixed-window counter in Firestore (`rateLimits/{key}_{window}`), so rate limits need no new
 * infrastructure. Keys are already hashes (never a raw IP or email). The doc carries `expiresAt`, so a TTL policy
 * on that field (optional, see docs/DEPLOYMENT.md) cleans up; without one the docs are tiny and simply stay.
 *
 * Every attempt counts, allowed or not, so retrying can't be used to probe the limit; the answer is `allowed`
 * while the count (this attempt included) is at or under `limit`.
 */
export async function consumeRateLimit(
  db: Firestore,
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now()
): Promise<{ allowed: boolean; count: number }> {
  const bucket = Math.floor(nowMs / windowMs);
  const ref = db.collection("rateLimits").doc(`${key}_${bucket}`);
  const count = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const next = (snap.exists ? (snap.data()?.count as number) : 0) + 1;
    txn.set(ref, { count: next, key, expiresAt: new Date((bucket + 2) * windowMs) });
    return next;
  });
  return { allowed: count <= limit, count };
}

/** Reads a counter without counting (for showing "applications from this IP in the last hour"). */
export async function peekRateLimit(db: Firestore, key: string, windowMs: number, nowMs: number = Date.now()): Promise<number> {
  const snap = await db.collection("rateLimits").doc(`${key}_${Math.floor(nowMs / windowMs)}`).get();
  return snap.exists ? ((snap.data()?.count as number) ?? 0) : 0;
}

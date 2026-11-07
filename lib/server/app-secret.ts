import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * P20: the server-only key that signs the form's start token and keys the IP/email hashes. Use
 * `APPLICATION_SECRET` if you set one (any long random string); otherwise it is derived from the Firebase Admin
 * private key, which is already a server-only secret, so nothing new has to be configured. Deployments that
 * rotate the Admin key also rotate this (open forms just get a fresh token; stored hashes simply stop matching).
 */
export function getServerSecret(): string {
  const explicit = process.env.APPLICATION_SECRET?.trim();
  if (explicit) return explicit;
  const adminKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (adminKey) return createHash("sha256").update(`compepicurus:application:${adminKey}`).digest("hex");
  throw new Error("No server secret: set APPLICATION_SECRET or FIREBASE_ADMIN_PRIVATE_KEY.");
}

/** HMAC-SHA256 of `value`, namespaced by `purpose`, as 32 hex characters: what is stored instead of an IP or an email. */
export function hashValue(purpose: string, value: string, secret: string = getServerSecret()): string {
  return createHmac("sha256", secret).update(`${purpose}\u0000${value}`).digest("hex").slice(0, 32);
}

export function signValue(payload: string, secret: string = getServerSecret()): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

import "server-only";

// Shared between app/api/auth/session/route.ts (sets/clears it) and
// lib/server/require-user.ts (reads it). Kept out of the route file itself
// since Next.js route handlers only expect HTTP-method exports.
export const SESSION_COOKIE_NAME = "session";
// Firebase Admin requires this between 5 minutes and 2 weeks; 5 days covers
// any realistic single-competition-weekend session without forcing a
// mid-event re-login. See docs/ASSUMPTIONS.md (P1-15).
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

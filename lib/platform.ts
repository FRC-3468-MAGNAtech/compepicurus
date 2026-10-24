/** Shared with lib/auth.tsx's Google redirect-fallback check — kept here too since practice sessions (P4) need it as a named, documented concept (PracticeSession.platform), not just an inline auth-flow detail. */
export function detectPlatform(): "pc" | "mobile" {
  if (typeof navigator === "undefined") return "pc";
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "pc";
}

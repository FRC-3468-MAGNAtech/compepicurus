import "server-only";

function parseEmailList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** OWNER_EMAILS / ADMIN_EMAILS — server-only env vars, comma-separated, compared case-insensitively. See .env.example and docs/ASSUMPTIONS.md (P1b). */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseEmailList(process.env.OWNER_EMAILS).has(email.toLowerCase());
}

/**
 * P20: is this verified ID token a **platform owner**? Checked on every platform-only server route against the
 * live OWNER_EMAILS list *and* a verified email (the `platformOwner` claim alone could be stale after someone is
 * removed from the env var), so revoking takes effect on the next request rather than the next sign-in.
 */
export function isPlatformOwnerToken(decoded: { email?: string | null; email_verified?: boolean; platformOwner?: unknown }): boolean {
  return decoded.platformOwner === true && decoded.email_verified === true && isOwnerEmail(decoded.email);
}

export function isPreconfiguredAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseEmailList(process.env.ADMIN_EMAILS).has(email.toLowerCase());
}

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

export function isPreconfiguredAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseEmailList(process.env.ADMIN_EMAILS).has(email.toLowerCase());
}

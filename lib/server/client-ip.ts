import "server-only";

/**
 * The caller's IP as the platform reports it. On Vercel `x-forwarded-for` is set by the edge (the first entry is
 * the client); elsewhere it may be absent. Never trusted for anything beyond rate limiting and a reviewer signal,
 * and it is hashed before it is stored.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

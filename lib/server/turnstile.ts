import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export type TurnstileResult = { configured: false } | { configured: true; ok: boolean; reason?: string };

/**
 * P20: verifies a Cloudflare Turnstile token on the server (`TURNSTILE_SECRET_KEY`, server-only). With no secret
 * configured it reports `configured: false` and the submit route carries on with every other measure (the
 * platform owner sees a warning in the review queue and a "No CAPTCHA" signal on each application). A network
 * failure reaching Cloudflare fails *closed* (not ok): a visitor can simply retry.
 */
export async function verifyTurnstile(token: unknown, remoteIp: string | null, fetchImpl: typeof fetch = fetch): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { configured: false };
  if (typeof token !== "string" || !token || token.length > 4096) return { configured: true, ok: false, reason: "missing-token" };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body });
    const json = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return json.success === true ? { configured: true, ok: true } : { configured: true, ok: false, reason: (json["error-codes"] ?? []).join(",") || "failed" };
  } catch {
    return { configured: true, ok: false, reason: "unreachable" };
  }
}

import { NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { isTurnstileConfigured } from "@/lib/server/turnstile";
import { isEmailConfigured } from "@/lib/server/email";

/**
 * P20: tells the platform owner which anti-abuse and notification pieces are actually configured, so Admin Panel >
 * Team Applications can warn when Turnstile (the CAPTCHA) or email isn't set up. Reports booleans only, never a key.
 */
export async function GET(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isPlatformOwnerToken(decoded)) return NextResponse.json({ ok: false, error: "Only the platform owner can see this." }, { status: 403 });
  return NextResponse.json({
    ok: true,
    turnstileSecretConfigured: isTurnstileConfigured(),
    turnstileSiteKeyConfigured: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
    emailConfigured: isEmailConfigured(),
  });
}

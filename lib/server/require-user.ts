import "server-only";
import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/server/session-cookie";

/**
 * Verifies the session cookie set by app/api/auth/session on every FIRST API
 * Server Action call (see lib/ftc/actions.ts). Returns null — never throws —
 * so callers can fold "not signed in" into the same ActionResult error shape
 * every other failure already uses, rather than a special code path.
 *
 * Returns the decoded uid even when FIREBASE_ADMIN_* isn't configured and
 * Firestore-side auth can't be double-checked here; in that case there's no
 * admin SDK to verify against, so this returns null and every FIRST API call
 * fails closed with "unauthorized" until the server is configured.
 */
export async function requireUser(): Promise<{ uid: string } | null> {
  const adminAuth = getAdminAuth();
  if (!adminAuth) return null;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

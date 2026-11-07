import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { APP_SETTINGS_PATH } from "@/lib/server/team-settings";

/**
 * Platform-owner-only switch backing Admin Panel's "Allow team creation" toggle (P20: a *team* owner can't turn
 * public creation on; only the platform owner, from OWNER_EMAILS, can). Gated on the verified token's
 * `platformOwner` claim plus the live OWNER_EMAILS list; no client can ever write appSettings directly (denied
 * in firestore.rules).
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isPlatformOwnerToken(decoded)) {
    return NextResponse.json({ ok: false, error: "Only the platform owner can change this." }, { status: 403 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "Missing 'enabled' boolean." }, { status: 400 });
  }

  await db.doc(APP_SETTINGS_PATH).set({ teamCreationEnabled: enabled }, { merge: true });
  return NextResponse.json({ ok: true, teamCreationEnabled: enabled });
}

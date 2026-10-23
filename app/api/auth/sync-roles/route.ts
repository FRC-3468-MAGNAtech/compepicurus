import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isOwnerEmail, isPreconfiguredAdminEmail } from "@/lib/server/owner-admin";
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";

/**
 * Called by the client right after every sign-in (see lib/auth.tsx). Grants
 * (never revokes, except owner→admin-only — see below) isOwner/isAdmin for
 * emails listed in the server-only OWNER_EMAILS/ADMIN_EMAILS env vars, and
 * mirrors the result onto Firebase custom claims so it's available on the
 * ID token immediately (no extra Firestore read needed elsewhere to check
 * "is this caller an owner"). Requires a *verified* email — otherwise
 * someone could register with the owner's address, before the real owner
 * ever signs up, and grant themselves owner/admin.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const email = decoded.email ?? null;
  const emailVerified = decoded.email_verified === true;
  const uid = decoded.uid;

  if (!emailVerified) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const wantsOwner = isOwnerEmail(email);
  const wantsAdmin = wantsOwner || isPreconfiguredAdminEmail(email);

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    // Owner convenience: a verified owner landing with no profile yet and
    // exactly one team in existence is attached to it automatically, no
    // join code needed. Anyone else (including a non-owner ADMIN_EMAILS
    // match, 0 teams, or 2+ teams) goes through the normal Finish
    // Setup/signup Join-or-Create flow instead.
    if (!wantsOwner) {
      return NextResponse.json({ ok: true, changed: false, attached: false });
    }
    const teamsSnap = await db.collection("teams").limit(2).get();
    if (teamsSnap.size !== 1) {
      return NextResponse.json({ ok: true, changed: false, attached: false });
    }
    const teamId = teamsSnap.docs[0].id;
    await userRef.set({
      name: decoded.name ?? "",
      email: email ?? "",
      teamId,
      primaryRole: DEFAULT_ROLE_ID,
      secondaryRoles: [],
      isAdmin: true,
      isOwner: true,
      themeId: defaultThemeId,
      createdAt: FieldValue.serverTimestamp(),
    });
    await adminAuth.setCustomUserClaims(uid, { owner: true, admin: true });
    return NextResponse.json({ ok: true, changed: true, attached: true });
  }

  const data = userSnap.data()!;
  const currentIsOwner = Boolean(data.isOwner);
  const currentIsAdmin = Boolean(data.isAdmin);

  let nextIsOwner = currentIsOwner;
  // Admin, once granted (by this sync or by another admin in Team
  // Management), is never auto-revoked here — only isOwner can be taken
  // back, and only because it dropped out of OWNER_EMAILS.
  let nextIsAdmin = currentIsAdmin;

  if (wantsOwner) {
    nextIsOwner = true;
    nextIsAdmin = true;
  } else if (currentIsOwner) {
    nextIsOwner = false;
  }
  if (wantsAdmin) {
    nextIsAdmin = true;
  }

  const firestoreChanged = nextIsOwner !== currentIsOwner || nextIsAdmin !== currentIsAdmin;
  if (firestoreChanged) {
    await userRef.update({ isOwner: nextIsOwner, isAdmin: nextIsAdmin });
  }

  const currentClaims = decoded as unknown as { owner?: boolean; admin?: boolean };
  const claimsChanged = Boolean(currentClaims.owner) !== nextIsOwner || Boolean(currentClaims.admin) !== nextIsAdmin;
  if (claimsChanged) {
    await adminAuth.setCustomUserClaims(uid, { owner: nextIsOwner, admin: nextIsAdmin });
  }

  return NextResponse.json({ ok: true, changed: firestoreChanged || claimsChanged });
}

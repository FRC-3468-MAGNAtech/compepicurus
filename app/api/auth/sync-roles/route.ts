import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isOwnerEmail, isPreconfiguredAdminEmail } from "@/lib/server/owner-admin";
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";
import { defaultMemberFieldTeamIds } from "@/lib/field-teams";
import { chooseBootstrapOwner } from "@/lib/team-owner";

/**
 * P20: the owner bootstrap. An account whose `teams/{teamId}.ownerUid` isn't set yet gets its team owner here:
 * the user already carrying the legacy `isOwner` flag (so the existing owner stays owner and is never locked
 * out), else a signing-in platform owner of that account. It runs **only while `ownerUid` is absent** (inside a
 * transaction that re-checks), which is what makes it impossible for this route to take ownership back after a
 * transfer. Any extra legacy owners are demoted to plain admins; `users.isOwner` is only the mirror of `ownerUid`.
 */
async function bootstrapTeamOwner(db: Firestore, teamId: string, caller: { uid: string; isPlatformOwner: boolean }): Promise<boolean> {
  const teamRef = db.collection("teams").doc(teamId);
  // The common case (an owner exists) costs one read, not a roster query on every sign-in.
  const firstLook = await teamRef.get();
  if (!firstLook.exists || (typeof firstLook.data()?.ownerUid === "string" && firstLook.data()?.ownerUid)) return false;
  const membersSnap = await db.collection("users").where("teamId", "==", teamId).get();
  return db.runTransaction(async (txn) => {
    const teamSnap = await txn.get(teamRef);
    if (!teamSnap.exists) return false;
    const existing = teamSnap.data()?.ownerUid;
    if (typeof existing === "string" && existing) return false; // never re-assert (or change) an owner that exists

    const users = membersSnap.docs.map((d) => {
      const created = d.data().createdAt;
      return { uid: d.id, isOwner: d.data().isOwner === true, createdAtMs: created && typeof created.toMillis === "function" ? created.toMillis() : 0 };
    });
    const choice = chooseBootstrapOwner({ users, caller });
    if (!choice.ownerUid) return false;

    txn.update(teamRef, { ownerUid: choice.ownerUid });
    const chosen = users.find((u) => u.uid === choice.ownerUid);
    if (chosen && !chosen.isOwner) txn.update(db.collection("users").doc(choice.ownerUid), { isOwner: true, isAdmin: true });
    for (const uid of choice.demoteUids) txn.update(db.collection("users").doc(uid), { isOwner: false });
    return true;
  });
}

/**
 * Called by the client right after every sign-in (see lib/auth.tsx). P20 split "owner" in two:
 *  - **Platform owner**: an email in the server-only OWNER_EMAILS (verified). This route grants the
 *    `platformOwner` custom claim and the `isPlatformOwner` mirror, and makes them an admin of their own account
 *    (admin, once granted, is never auto-revoked). It no longer touches team ownership except for the bootstrap
 *    above, and it removes the claim again if the email leaves OWNER_EMAILS.
 *  - **Team owner**: `teams/{teamId}.ownerUid`, changed only by the transfer routes.
 * Also grants admin for ADMIN_EMAILS. Requires a *verified* email, otherwise someone could register with the
 * owner's address before the real owner ever signs up and grant themselves access.
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

  const wantsPlatformOwner = isOwnerEmail(email);
  const wantsAdmin = wantsPlatformOwner || isPreconfiguredAdminEmail(email);

  if (!emailVerified) {
    // Nothing is granted, but say so (FIX2): the owner would otherwise just see controls silently missing.
    return NextResponse.json({ ok: true, changed: false, ownerPendingVerification: wantsPlatformOwner });
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    // Owner convenience: a verified platform owner landing with no profile yet and exactly one team in existence
    // is attached to it automatically (as an admin), no join code needed. Anyone else goes through the normal
    // Finish Setup flow (join, or apply).
    if (!wantsPlatformOwner) {
      return NextResponse.json({ ok: true, changed: false, attached: false });
    }
    const teamsSnap = await db.collection("teams").limit(2).get();
    if (teamsSnap.size !== 1) {
      return NextResponse.json({ ok: true, changed: false, attached: false });
    }
    const teamId = teamsSnap.docs[0].id;
    await userRef.set({
      fieldTeamIds: defaultMemberFieldTeamIds(teamsSnap.docs[0].data()),
      name: decoded.name ?? "",
      email: email ?? "",
      teamId,
      primaryRole: DEFAULT_ROLE_ID,
      secondaryRoles: [],
      isAdmin: true,
      isOwner: false,
      isPlatformOwner: true,
      themeId: defaultThemeId,
      createdAt: FieldValue.serverTimestamp(),
    });
    await adminAuth.setCustomUserClaims(uid, { platformOwner: true, admin: true });
    await bootstrapTeamOwner(db, teamId, { uid, isPlatformOwner: true });
    return NextResponse.json({ ok: true, changed: true, attached: true });
  }

  const data = userSnap.data()!;
  const currentIsPlatformOwner = data.isPlatformOwner === true;
  const currentIsAdmin = Boolean(data.isAdmin);

  // Admin, once granted (by this sync or by another admin in Team Management), is never auto-revoked here.
  const nextIsPlatformOwner = wantsPlatformOwner;
  const nextIsAdmin = currentIsAdmin || wantsAdmin;

  const patch: Record<string, unknown> = {};
  if (nextIsPlatformOwner !== currentIsPlatformOwner) patch.isPlatformOwner = nextIsPlatformOwner;
  if (nextIsAdmin !== currentIsAdmin) patch.isAdmin = nextIsAdmin;
  const firestoreChanged = Object.keys(patch).length > 0;
  if (firestoreChanged) await userRef.update(patch);

  const currentClaims = decoded as unknown as { platformOwner?: boolean; admin?: boolean; owner?: unknown };
  // `owner` is the pre-P20 claim: it must go, so a stale token can't keep acting as an owner anywhere.
  const claimsChanged =
    Boolean(currentClaims.platformOwner) !== nextIsPlatformOwner || Boolean(currentClaims.admin) !== nextIsAdmin || currentClaims.owner !== undefined;
  if (claimsChanged) {
    await adminAuth.setCustomUserClaims(uid, { platformOwner: nextIsPlatformOwner, admin: nextIsAdmin });
  }

  // Team ownership: only ever fills in an account that has no owner yet.
  const teamId = typeof data.teamId === "string" ? data.teamId : null;
  const bootstrapped = teamId ? await bootstrapTeamOwner(db, teamId, { uid, isPlatformOwner: nextIsPlatformOwner }) : false;

  return NextResponse.json({ ok: true, changed: firestoreChanged || claimsChanged || bootstrapped });
}

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";

/**
 * Validates a join code and creates the caller's user doc server-side.
 * Not explicitly asked for by P1b (which only mandates a server route for
 * *creating* a team) — added alongside it to close a real gap: P1's
 * firestore.rules only checked that the target team *existed* on
 * users/{uid} create, never that the caller actually supplied a matching
 * join code, so any signed-in user could already join any team by id
 * without knowing its code. That was a low-severity trade-off worth
 * accepting for a single-team app (see P1-4), but P1b's "other teams"
 * language means more than one team can now exist, which makes the gap a
 * real cross-team access issue. See docs/ASSUMPTIONS.md (P1b).
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const joinCode = typeof body?.joinCode === "string" ? body.joinCode.trim() : "";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : decoded.name ?? "";
  if (!joinCode) return NextResponse.json({ ok: false, error: "Enter a join code." }, { status: 400 });

  const userRef = db.collection("users").doc(decoded.uid);
  const existing = await userRef.get();
  if (existing.exists) {
    return NextResponse.json({ ok: false, error: "You're already on a team." }, { status: 409 });
  }

  const teamQuery = await db.collection("teams").where("joinCode", "==", joinCode).limit(1).get();
  if (teamQuery.empty) {
    return NextResponse.json({ ok: false, error: "That join code doesn't match any team." }, { status: 404 });
  }
  const teamDoc = teamQuery.docs[0];

  await userRef.set({
    name,
    email: decoded.email ?? "",
    teamId: teamDoc.id,
    primaryRole: DEFAULT_ROLE_ID,
    secondaryRoles: [],
    isAdmin: false,
    isOwner: false,
    themeId: defaultThemeId,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, teamId: teamDoc.id });
}

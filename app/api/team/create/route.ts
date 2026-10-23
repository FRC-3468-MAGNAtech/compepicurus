import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { APP_SETTINGS_PATH, getTeamCreationEnabledInTransaction, randomJoinCode } from "@/lib/server/team-settings";
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";

/**
 * Creates a new team, makes the caller its admin, and disables further team
 * creation — all inside one Firestore transaction, so two simultaneous
 * attempts can't both succeed (the loser's transaction retries against the
 * now-`false` setting and is rejected). Replaces P1's client-side
 * firstRunSetup()/`/setup` page entirely — see docs/ASSUMPTIONS.md (P1b).
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const teamNumber = Number(body?.teamNumber);
  const teamName = typeof body?.teamName === "string" && body.teamName.trim() ? body.teamName.trim() : null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : decoded.name ?? "";
  if (!Number.isInteger(teamNumber) || teamNumber <= 0) {
    return NextResponse.json({ ok: false, error: "Enter a valid team number." }, { status: 400 });
  }

  try {
    const result = await db.runTransaction(async (txn) => {
      const userRef = db.collection("users").doc(decoded.uid);
      // Reads must happen before any writes in a Firestore transaction.
      const [userSnap, creationEnabled] = await Promise.all([
        txn.get(userRef),
        getTeamCreationEnabledInTransaction(db, txn),
      ]);

      if (userSnap.exists) {
        throw new RouteError(409, "You're already on a team.");
      }
      if (!creationEnabled) {
        throw new RouteError(403, "Team creation is currently disabled.");
      }

      const teamRef = db.collection("teams").doc();
      const joinCode = randomJoinCode();

      txn.set(teamRef, {
        number: teamNumber,
        name: teamName,
        joinCode,
        activeEventCode: null,
        activeSeasonId: null,
        activeEvent: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      txn.set(userRef, {
        name,
        email: decoded.email ?? "",
        teamId: teamRef.id,
        primaryRole: DEFAULT_ROLE_ID,
        secondaryRoles: [],
        isAdmin: true,
        isOwner: false,
        themeId: defaultThemeId,
        createdAt: FieldValue.serverTimestamp(),
      });
      txn.set(db.doc(APP_SETTINGS_PATH), { teamCreationEnabled: false }, { merge: true });

      return { joinCode, teamId: teamRef.id };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RouteError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: "Something went wrong creating the team." }, { status: 500 });
  }
}

class RouteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

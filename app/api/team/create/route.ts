import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { APP_SETTINGS_PATH, getTeamCreationEnabledInTransaction, randomJoinCode } from "@/lib/server/team-settings";
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";
import { migratedFieldTeamId } from "@/lib/field-teams";

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

      // P19: the number the creator enters is the account's first FTC team (more are added in Team Settings).
      const firstFieldTeam = { id: migratedFieldTeamId(teamNumber), number: teamNumber, name: teamName ?? "" };
      txn.set(teamRef, {
        number: teamNumber,
        name: teamName,
        fieldTeams: [firstFieldTeam],
        fieldTeamIdList: [firstFieldTeam.id],
        fieldTeamNumbers: [teamNumber],
        // P20: whoever creates the account is its team owner (transferable; see lib/team-owner.ts).
        ownerUid: decoded.uid,
        joinCode,
        activeEventCode: null,
        activeSeasonId: null,
        activeEvent: null,
        activeEventCodes: [],
        activeEvents: [],
        createdAt: FieldValue.serverTimestamp(),
      });
      txn.set(userRef, {
        name,
        email: decoded.email ?? "",
        teamId: teamRef.id,
        primaryRole: DEFAULT_ROLE_ID,
        secondaryRoles: [],
        isAdmin: true,
        isOwner: true, // mirror of teams.ownerUid, written only by server routes
        fieldTeamIds: [firstFieldTeam.id],
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

import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { syncFieldTeams } from "@/lib/server/field-teams-sync";

/**
 * P19: the idempotent FTC-teams migration for the caller's own team account (the team comes from
 * the caller's profile, never from the request). Called best-effort by the client after every
 * sign-in (lib/auth.tsx via lib/team-enrollment.ts), so the first sign-in after deploy migrates
 * the account and every later one is a cheap no-op. Any signed-in member may trigger it: it only
 * ever fills in what is missing, and the result doesn't depend on who ran it.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const userSnap = await db.collection("users").doc(decoded.uid).get();
  const teamId = userSnap.exists ? userSnap.data()?.teamId : null;
  if (typeof teamId !== "string" || !teamId) {
    // Signed in but not on a team yet (finishing setup): nothing to migrate.
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const result = await syncFieldTeams(db, teamId);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't update the team's FTC teams." }, { status: 500 });
  }
}

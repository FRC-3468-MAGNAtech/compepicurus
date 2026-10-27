import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/server/require-user";
import { resolveLobbyResults } from "@/lib/lobby/resolve-results";

/**
 * P8: finalizes a Live Practice Lobby round — called by whichever open
 * client first notices every scouting player has submitted, by the host's
 * "End Scouting" button, or after the grace period past the video's own
 * runtime. Session-authed only (no CRON_SECRET route like P7's live mode
 * needs — a library match's official score is already known, so there's
 * nothing to wait on and no scheduled sweep required). Idempotent: see
 * lib/lobby/resolve-results.ts.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { lobbyId?: string } | null;
  const lobbyId = body?.lobbyId;
  if (!lobbyId) return NextResponse.json({ ok: false, error: "Missing lobbyId." }, { status: 400 });

  try {
    const lobbySnap = await db.collection("lobbies").doc(lobbyId).get();
    if (!lobbySnap.exists) return NextResponse.json({ ok: false, error: "Lobby not found." }, { status: 404 });
    const userSnap = await db.collection("users").doc(user.uid).get();
    if (!userSnap.exists || userSnap.data()?.teamId !== lobbySnap.data()?.teamId) {
      return NextResponse.json({ ok: false, error: "Not your team's lobby." }, { status: 403 });
    }

    const result = await resolveLobbyResults(db, lobbyId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("resolve-results failed:", err);
    return NextResponse.json({ ok: false, error: "Internal error." }, { status: 500 });
  }
}

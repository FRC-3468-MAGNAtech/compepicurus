import "server-only";
import { FieldValue, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { resolveLobbyPairScoring } from "@/lib/lobby/scoring";
import type { LobbyDoc } from "@/lib/lobby";
import type { LibraryMatch } from "@/lib/match-library";
import type { ScoutEntry } from "@/lib/scout-entries";

async function hadPriorCompletedAttempt(
  db: Firestore,
  teamId: string,
  uid: string,
  libraryMatchId: string,
  alliance: string,
  excludeSessionId: string
): Promise<boolean> {
  const snap = await db
    .collection("practiceSessions")
    .where("teamId", "==", teamId)
    .where("uid", "==", uid)
    .where("libraryMatchId", "==", libraryMatchId)
    .where("alliance", "==", alliance)
    .where("status", "==", "completed")
    .limit(5)
    .get();
  return snap.docs.some((d) => d.id !== excludeSessionId);
}

/**
 * The core of `app/api/lobby/resolve-results` (P8) — Admin SDK, so it
 * bypasses firestore.rules entirely. A lobby pair's two sessions belong to
 * two *different* players, and firestore.rules only lets each own their own
 * session once it's `completed` (never a teammate, not even the host) — so
 * finalizing a pair's shared accuracy/flags has to happen here, the same
 * reason P7's live-mode scoring is Admin-SDK-resolved rather than written
 * client-side. Unlike live mode there's no "waiting for a score to post" —
 * a library match's official score is already known, so this runs once, at
 * the moment the round ends, not on a repeating poll. Idempotent via the
 * lobby's own `status`: once flipped to "results" a second call is a no-op.
 */
export async function resolveLobbyResults(db: Firestore, lobbyId: string): Promise<{ resolved: number; totalPairs: number }> {
  const lobbyRef = db.collection("lobbies").doc(lobbyId);
  const lobbySnap = await lobbyRef.get();
  if (!lobbySnap.exists) return { resolved: 0, totalPairs: 0 };
  const lobby = { id: lobbySnap.id, ...lobbySnap.data() } as LobbyDoc;
  if (lobby.status === "results" || lobby.status === "closed") return { resolved: 0, totalPairs: lobby.pairing?.length ?? 0 };
  if (!lobby.libraryMatchId || !lobby.pairing || lobby.pairing.length === 0) return { resolved: 0, totalPairs: 0 };

  const matchSnap = await db.collection("libraryMatches").doc(lobby.libraryMatchId).get();
  if (!matchSnap.exists) return { resolved: 0, totalPairs: lobby.pairing.length };
  const match = { id: matchSnap.id, ...matchSnap.data() } as LibraryMatch;

  const sessionsSnap = await db
    .collection("practiceSessions")
    .where("teamId", "==", lobby.teamId)
    .where("lobbyId", "==", lobbyId)
    .where("status", "==", "completed")
    .get();
  const sessionsByPairId = new Map<string, QueryDocumentSnapshot[]>();
  for (const docSnap of sessionsSnap.docs) {
    const pairId: string | null = docSnap.data().pairId ?? null;
    if (!pairId) continue;
    const list = sessionsByPairId.get(pairId) ?? [];
    list.push(docSnap);
    sessionsByPairId.set(pairId, list);
  }

  let resolved = 0;
  for (const pair of lobby.pairing) {
    const docs = sessionsByPairId.get(pair.pairId);
    if (!docs || docs.length !== 2) continue; // incomplete pair — "did not finish"

    const [a, b] = docs;
    const da = a.data();
    const entryIdA: string | undefined = da.entryIds?.[0];
    const entryIdB: string | undefined = b.data().entryIds?.[0];
    if (!entryIdA || !entryIdB) continue;

    const [entrySnapA, entrySnapB] = await Promise.all([
      db.collection("scoutEntries").doc(entryIdA).get(),
      db.collection("scoutEntries").doc(entryIdB).get(),
    ]);
    if (!entrySnapA.exists || !entrySnapB.exists) continue;
    const entryA = { id: entrySnapA.id, ...entrySnapA.data() } as ScoutEntry;
    const entryB = { id: entrySnapB.id, ...entrySnapB.data() } as ScoutEntry;

    const [priorA, priorB] = await Promise.all([
      hadPriorCompletedAttempt(db, lobby.teamId, a.data().uid, lobby.libraryMatchId, pair.alliance, a.id),
      hadPriorCompletedAttempt(db, lobby.teamId, b.data().uid, lobby.libraryMatchId, pair.alliance, b.id),
    ]);

    const result = resolveLobbyPairScoring(match, pair.alliance, [entryA, entryB], lobby.mode, priorA || priorB);

    const batch = db.batch();
    for (const sessionDoc of docs) {
      batch.update(sessionDoc.ref, {
        accuracy: result.accuracy,
        scoutedTotal: result.scoutedTotal,
        officialScore: result.officialScore,
        penaltyPoints: result.penaltyPoints,
        flags: result.flags,
      });
    }
    await batch.commit();
    resolved++;
  }

  await lobbyRef.update({ status: "results", resolvedAt: FieldValue.serverTimestamp() });
  return { resolved, totalPairs: lobby.pairing.length };
}

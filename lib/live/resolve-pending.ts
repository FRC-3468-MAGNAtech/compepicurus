import "server-only";
import { FieldValue, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { fetchMatchesForEventInternal } from "@/lib/ftc/matches-internal";
import type { FtcMatch } from "@/lib/ftc/types";
import { LIVE_CONFIG } from "@/lib/live/config";
import { isAllianceReadyToNotify } from "@/lib/live/notify";
import { resolveLiveAllianceScoring } from "@/lib/live/scoring";
import type { ScoutEntry } from "@/lib/scout-entries";

/**
 * The core of both app/api/cron/poll-live-scores and
 * app/api/live/check-scores (P7) — Admin SDK, so it bypasses
 * firestore.rules entirely; both routes have their own separate auth
 * (a CRON_SECRET bearer token / a verified signed-in session) rather than
 * relying on rules here. Idempotent by construction: a session only ever
 * matches the "pending" query (`accuracy == null`) once, so writing a
 * resolved accuracy is itself what prevents reprocessing on the next run
 * — no separate "already handled" flag needed. Notification docs are
 * additionally keyed by session id, so even a true double-run that somehow
 * re-resolved the same alliance wouldn't re-send a push.
 */
export async function resolvePendingLiveMatches(db: Firestore, messaging: Messaging | null, uid?: string): Promise<{ checked: number; resolved: number }> {
  let q = db.collection("practiceSessions").where("kind", "==", "live").where("status", "==", "completed").where("accuracy", "==", null);
  if (uid) q = q.where("uid", "==", uid);
  const snap = await q.get();
  if (snap.empty) return { checked: 0, resolved: 0 };

  const groups = new Map<string, QueryDocumentSnapshot[]>();
  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    if (!d.eventCode || !d.matchType || d.matchNumber == null || !d.alliance) continue;
    const key = `${d.teamId}|${d.eventCode}|${d.matchType}|${d.matchNumber}|${d.alliance}`;
    const list = groups.get(key) ?? [];
    list.push(docSnap);
    groups.set(key, list);
  }

  const matchCache = new Map<string, FtcMatch[]>();
  let resolved = 0;

  for (const docs of groups.values()) {
    if (docs.length !== 2) continue; // alliance not yet covered by two completed sessions
    const [a, b] = docs;
    const da = a.data();

    const matchCacheKey = `${da.eventCode}|${da.matchType}`;
    let matches = matchCache.get(matchCacheKey);
    if (!matches) {
      try {
        matches = await fetchMatchesForEventInternal(da.eventCode, da.matchType);
      } catch (err) {
        console.error("poll-live-scores: failed to fetch matches for", matchCacheKey, err);
        continue;
      }
      matchCache.set(matchCacheKey, matches);
    }
    const match = matches.find((m) => m.matchNumber === da.matchNumber);
    if (!match) continue;

    const entryIdA: string | undefined = a.data().entryIds?.[0];
    const entryIdB: string | undefined = b.data().entryIds?.[0];
    if (!entryIdA || !entryIdB) continue;

    const [entrySnapA, entrySnapB] = await Promise.all([
      db.collection("scoutEntries").doc(entryIdA).get(),
      db.collection("scoutEntries").doc(entryIdB).get(),
    ]);
    if (!entrySnapA.exists || !entrySnapB.exists) continue;
    const entryA = { id: entrySnapA.id, ...entrySnapA.data() } as ScoutEntry;
    const entryB = { id: entrySnapB.id, ...entrySnapB.data() } as ScoutEntry;

    const result = resolveLiveAllianceScoring(match, da.alliance, [entryA, entryB]);
    if (!result) continue; // score hasn't posted yet

    const batch = db.batch();
    for (const sessionDoc of docs) {
      batch.update(sessionDoc.ref, {
        accuracy: result.sessionAccuracy,
        scoutedTotal: result.sessionScoutedTotal,
        officialScore: result.sessionOfficialScore,
        penaltyPoints: result.sessionPenaltyPoints,
        flags: result.sessionFlags,
      });
    }
    batch.update(db.collection("scoutEntries").doc(entryA.id), {
      accuracy: result.entryAccuracy,
      autoFlags: result.entryAutoFlags[entryA.id] ?? [],
    });
    batch.update(db.collection("scoutEntries").doc(entryB.id), {
      accuracy: result.entryAccuracy,
      autoFlags: result.entryAutoFlags[entryB.id] ?? [],
    });
    await batch.commit();
    resolved++;

    const notifyEligible = isAllianceReadyToNotify(
      [
        { uid: entryA.uid, submittedAt: entryA.submittedAt },
        { uid: entryB.uid, submittedAt: entryB.submittedAt },
      ],
      LIVE_CONFIG.LIVE_BOTH_ROBOTS_WINDOW_MINUTES
    );
    if (notifyEligible) {
      await notifyScoutsForSessions(db, messaging, docs, da.teamId);
    }
  }

  return { checked: snap.size, resolved };
}

async function notifyScoutsForSessions(db: Firestore, messaging: Messaging | null, sessionDocs: QueryDocumentSnapshot[], teamId: string): Promise<void> {
  for (const sessionDoc of sessionDocs) {
    const s = sessionDoc.data();
    const notificationRef = db.collection("notifications").doc(sessionDoc.id);
    const existing = await notificationRef.get();
    if (existing.exists) continue; // idempotency guard

    const title = "Scores are available";
    const body = `Your live match (${s.matchType} ${s.matchNumber}) has been scored.`;
    await notificationRef.set({
      teamId,
      uid: s.uid,
      sessionId: sessionDoc.id,
      type: "live-score-ready",
      title,
      body,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (!messaging) continue;
    try {
      const userSnap = await db.collection("users").doc(s.uid).get();
      const tokens: string[] = userSnap.data()?.fcmTokens ?? [];
      if (tokens.length === 0) continue;
      await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { sessionId: sessionDoc.id, url: "/practice-scouting" },
      });
    } catch (err) {
      // Push delivery failing shouldn't undo the already-written notification
      // doc or scoring — the in-app "View results" list still works either way.
      console.error("poll-live-scores: push send failed for", s.uid, err);
    }
  }
}

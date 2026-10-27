import { resolveLobbyPairScoring } from "@/lib/lobby/scoring";
import { resolveLiveAllianceScoring } from "@/lib/live/scoring";
import { calculateScore, getFormSchema, scoutEntryFieldsToValues } from "@/lib/scout-form/schema";
import { updateEntry, type ScoutEntry } from "@/lib/scout-entries";
import { updatePracticeSession, type PracticeSession } from "@/lib/practice-sessions";
import type { LibraryMatch } from "@/lib/match-library";
import type { FtcMatch } from "@/lib/ftc/types";

export type SessionRescoreFilter = {
  seasonId?: string | null;
  eventCode?: string | null;
  /** ISO — compared against the session's own `startedAt`. */
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type SessionRescorePatch = {
  /** One session for solo, two for a lobby pair or a live alliance pair. */
  sessionIds: string[];
  kind: "solo" | "lobby" | "live";
  matchLabel: string;
  scoutNames: string[];
  /** `session.accuracy` (0-100) before/after — null if it couldn't be resolved either time. */
  before: number | null;
  after: number | null;
  sessionWrites: { sessionId: string; patch: Partial<PracticeSession> }[];
  entryWrites: { entryId: string; patch: Partial<ScoutEntry> }[];
};

function matchesFilter(session: PracticeSession, filter: SessionRescoreFilter): boolean {
  if (filter.seasonId && session.seasonId !== filter.seasonId) return false;
  if (filter.eventCode && session.eventCode !== filter.eventCode) return false;
  if (filter.dateFrom && session.startedAt < filter.dateFrom) return false;
  if (filter.dateTo && session.startedAt > filter.dateTo) return false;
  return true;
}

/** Recalculates one entry's `score` from its stored `fields`, using its own `formId` — the schema-driven step every rescore starts with, per the spec. */
function rescoredEntry(entry: ScoutEntry): ScoutEntry {
  const schema = getFormSchema(entry.formId);
  const score = calculateScore(schema, scoutEntryFieldsToValues(entry.fields));
  return { ...entry, score };
}

function entryScoreWrite(original: ScoutEntry, rescored: ScoutEntry): { entryId: string; patch: Partial<ScoutEntry> } | null {
  if (JSON.stringify(original.score) === JSON.stringify(rescored.score)) return null;
  return { entryId: original.id, patch: { score: rescored.score } };
}

function matchLabelFor(session: PracticeSession): string {
  return session.matchType && session.matchNumber !== null ? `${session.matchType} ${session.matchNumber}` : (session.libraryMatchId ?? "?");
}

/**
 * Builds the full dry-run/apply plan for rescoring every completed solo,
 * lobby, and live session that matches `filter` — pure given already-fetched
 * data, so the Admin Panel's dry-run preview and its "Apply" step always
 * agree (same plan, just whether `applySessionRescorePlan` runs after).
 *
 * Reuses `lib/lobby/scoring.ts`'s `resolveLobbyPairScoring` for BOTH solo and
 * lobby sessions — despite the name, it's generic over any two same-alliance
 * entries scored against a `LibraryMatch`; see docs/ASSUMPTIONS.md (P9).
 * Live sessions reuse `resolveLiveAllianceScoring` against freshly-passed-in
 * `FtcMatch` data instead (the caller fetches that via the `getMatchesForEvent`
 * Server Action, same as `recomputeForEvent` does for real-event entries).
 *
 * `priorCompletedAttempt` is always passed as `false` — reconstructing
 * whether a *historical* session was a repeat attempt as of when it was
 * originally scored isn't attempted; see docs/ASSUMPTIONS.md (P9).
 */
export function buildSessionRescorePlan(
  sessions: PracticeSession[],
  entries: ScoutEntry[],
  libraryMatchesById: Map<string, LibraryMatch>,
  liveMatchesByKey: Map<string, FtcMatch>,
  filter: SessionRescoreFilter
): SessionRescorePatch[] {
  const entriesBySessionId = new Map<string, ScoutEntry[]>();
  for (const e of entries) {
    if (!e.sessionId) continue;
    const list = entriesBySessionId.get(e.sessionId) ?? [];
    list.push(e);
    entriesBySessionId.set(e.sessionId, list);
  }

  const completed = sessions.filter((s) => s.status === "completed" && matchesFilter(s, filter));
  const patches: SessionRescorePatch[] = [];

  // Solo: one session owns both robots' entries.
  for (const session of completed.filter((s) => s.kind === "solo")) {
    if (!session.libraryMatchId || !session.alliance) continue;
    const match = libraryMatchesById.get(session.libraryMatchId);
    const sessionEntries = entriesBySessionId.get(session.id) ?? [];
    if (!match || sessionEntries.length !== 2) continue;
    const rescored = sessionEntries.map(rescoredEntry) as [ScoutEntry, ScoutEntry];
    const result = resolveLobbyPairScoring(match, session.alliance, rescored, session.mode, false);

    const entryWrites = sessionEntries
      .map((orig, i) => entryScoreWrite(orig, rescored[i]))
      .filter((w): w is NonNullable<typeof w> => w !== null);

    patches.push({
      sessionIds: [session.id],
      kind: "solo",
      matchLabel: matchLabelFor(session),
      scoutNames: [session.scoutName],
      before: session.accuracy,
      after: result.accuracy,
      sessionWrites: [
        {
          sessionId: session.id,
          patch: { accuracy: result.accuracy, scoutedTotal: result.scoutedTotal, officialScore: result.officialScore, penaltyPoints: result.penaltyPoints, flags: result.flags },
        },
      ],
      entryWrites,
    });
  }

  // Lobby: two sessions (one per player) share a pairId.
  const lobbyGroups = new Map<string, PracticeSession[]>();
  for (const session of completed.filter((s) => s.kind === "lobby")) {
    if (!session.lobbyId || !session.pairId) continue;
    const key = `${session.lobbyId}|${session.pairId}`;
    const list = lobbyGroups.get(key) ?? [];
    list.push(session);
    lobbyGroups.set(key, list);
  }
  for (const group of lobbyGroups.values()) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    if (!a.libraryMatchId || !a.alliance) continue;
    const match = libraryMatchesById.get(a.libraryMatchId);
    const entryA = (entriesBySessionId.get(a.id) ?? [])[0];
    const entryB = (entriesBySessionId.get(b.id) ?? [])[0];
    if (!match || !entryA || !entryB) continue;
    const [rescoredA, rescoredB] = [rescoredEntry(entryA), rescoredEntry(entryB)];
    const result = resolveLobbyPairScoring(match, a.alliance, [rescoredA, rescoredB], a.mode, false);

    const entryWrites = [entryScoreWrite(entryA, rescoredA), entryScoreWrite(entryB, rescoredB)].filter(
      (w): w is NonNullable<typeof w> => w !== null
    );
    const sessionPatch = { accuracy: result.accuracy, scoutedTotal: result.scoutedTotal, officialScore: result.officialScore, penaltyPoints: result.penaltyPoints, flags: result.flags };

    patches.push({
      sessionIds: [a.id, b.id],
      kind: "lobby",
      matchLabel: matchLabelFor(a),
      scoutNames: [a.scoutName, b.scoutName],
      before: a.accuracy,
      after: result.accuracy,
      sessionWrites: [
        { sessionId: a.id, patch: sessionPatch },
        { sessionId: b.id, patch: sessionPatch },
      ],
      entryWrites,
    });
  }

  // Live: two sessions (one per robot) share eventCode+matchType+matchNumber+alliance.
  const liveGroups = new Map<string, PracticeSession[]>();
  for (const session of completed.filter((s) => s.kind === "live")) {
    if (!session.eventCode || !session.matchType || session.matchNumber === null || !session.alliance) continue;
    const key = `${session.eventCode}|${session.matchType}|${session.matchNumber}|${session.alliance}`;
    const list = liveGroups.get(key) ?? [];
    list.push(session);
    liveGroups.set(key, list);
  }
  for (const group of liveGroups.values()) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    const matchKey = `${a.eventCode}|${a.matchType}|${a.matchNumber}`;
    const match = liveMatchesByKey.get(matchKey);
    const entryA = (entriesBySessionId.get(a.id) ?? [])[0];
    const entryB = (entriesBySessionId.get(b.id) ?? [])[0];
    if (!match || !entryA || !entryB || !a.alliance) continue;
    const [rescoredA, rescoredB] = [rescoredEntry(entryA), rescoredEntry(entryB)];
    const result = resolveLiveAllianceScoring(match, a.alliance, [rescoredA, rescoredB]);
    if (!result) continue; // official score not posted

    const entryWrites = [entryScoreWrite(entryA, rescoredA), entryScoreWrite(entryB, rescoredB)].filter(
      (w): w is NonNullable<typeof w> => w !== null
    );
    // Live entries also get the real-event-style accuracy/autoFlags pair
    // (see `resolveLiveAllianceScoring`'s own doc comment) — always written,
    // regardless of whether the score itself changed.
    for (const id of [entryA.id, entryB.id]) {
      entryWrites.push({ entryId: id, patch: { accuracy: result.entryAccuracy, autoFlags: result.entryAutoFlags[id] ?? [] } });
    }
    const sessionPatch = {
      accuracy: result.sessionAccuracy,
      scoutedTotal: result.sessionScoutedTotal,
      officialScore: result.sessionOfficialScore,
      penaltyPoints: result.sessionPenaltyPoints,
      flags: result.sessionFlags,
    };

    patches.push({
      sessionIds: [a.id, b.id],
      kind: "live",
      matchLabel: matchLabelFor(a),
      scoutNames: [a.scoutName, b.scoutName],
      before: a.accuracy,
      after: result.sessionAccuracy,
      sessionWrites: [
        { sessionId: a.id, patch: sessionPatch },
        { sessionId: b.id, patch: sessionPatch },
      ],
      entryWrites,
    });
  }

  return patches;
}

/**
 * A patch is worth surfacing in the dry-run summary when the session's own
 * accuracy actually moves — the one number every row in the preview shows.
 * `entryWrites`/`sessionWrites` still always get applied on "Apply" even for
 * a patch that doesn't "change" by this definition (e.g. a live session
 * whose accuracy/autoFlags get refreshed from the same official score, or a
 * score recalculation that happens to land on the same total).
 */
export function sessionRescorePatchChanges(patch: SessionRescorePatch): boolean {
  return patch.before !== patch.after;
}

const BATCH_CHUNK_SIZE = 400;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Applies a rescore plan in chunks (Firestore's write limit is 500 ops per
 * batch; 400 leaves headroom) and reports progress as each chunk finishes —
 * safe to re-run, since `buildSessionRescorePlan` is deterministic given the
 * current data (re-applying an already-applied plan just writes the same
 * values again).
 */
export async function applySessionRescorePlan(patches: SessionRescorePatch[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const sessionWrites = patches.flatMap((p) => p.sessionWrites);
  const entryWrites = patches.flatMap((p) => p.entryWrites);
  const allWrites = [
    ...sessionWrites.map((w) => () => updatePracticeSession(w.sessionId, w.patch)),
    ...entryWrites.map((w) => () => updateEntry(w.entryId, w.patch)),
  ];
  const chunks = chunk(allWrites, BATCH_CHUNK_SIZE);
  let done = 0;
  for (const group of chunks) {
    await Promise.all(group.map((write) => write()));
    done += group.length;
    onProgress?.(done, allWrites.length);
  }
}

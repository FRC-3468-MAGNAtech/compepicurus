"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase/client";
import { getEvent, getMatchesForEvent } from "@/lib/ftc/actions";
import { parseCsv } from "@/lib/analytics/csv";
import { getDifficulty, type Difficulty } from "@/lib/difficulty";
import { decideMatchWrite, libraryMatchId, originOf, type LibraryOrigin } from "@/lib/library/ids";
import { getSeason } from "@/lib/seasons";
import type { MatchType } from "@/lib/ftc/types";

// The id format lives in lib/library/ids.ts (pure, so tests and the manual-entry
// code can use it without Firebase); re-exported here so existing imports keep working.
export { libraryMatchId };
export type { LibraryOrigin };

/**
 * Deliberately NOT teamId-scoped — this is public, real FTC competition
 * data (the same for every team), not this team's own scouting data, and
 * the prompt's own field list for libraryMatches omits teamId. See
 * docs/ASSUMPTIONS.md (P3) for the write-access trade-off this implies.
 */

export type LibraryAlliance = {
  teams: number[];
  score: number;
  penaltyPoints: number;
  difficulty: Difficulty;
};

export type LibraryVideo = { youtubeUrl: string; startSec: number; endSec: number };

export type LibraryMatch = {
  id: string;
  seasonId: string;
  eventCode: string;
  eventName: string;
  matchType: MatchType;
  matchNumber: number;
  alliances: { red: LibraryAlliance; blue: LibraryAlliance };
  video: LibraryVideo | null;
  /** ISO. Set once, on first import — never touched again (see importLibraryEvent). */
  importedAt: string;
  /** ISO. Updated every time scores are (re-)imported. */
  scoresUpdatedAt: string;
  /** P15: where the match came from. Absent on a pre-P15 doc, which is an API match (`originOf()`). Never changes after creation. */
  origin?: LibraryOrigin;
  /** P15: unpublished matches are hidden from everyone but admins. Absent on a pre-P15 doc until the one-time backfill. */
  published?: boolean;
  /** P15, manual matches imported from CSV/paste: awaiting an admin's review before publishing. */
  needsReview?: boolean;
  /** P15, manual matches only. */
  createdBy?: string;
  /** P15, manual matches only (ISO). */
  updatedAt?: string;
  /** P15, manual matches only. */
  notes?: string;
};

const COLLECTION = "libraryMatches";
const EVENTS = "libraryEvents";

export type ImportSummary = {
  eventName: string;
  imported: number;
  skipped: number;
  /** P15: ids left untouched because a manual match with the same id exists — an API import never overwrites one. */
  skippedManual: string[];
};

/**
 * Imports every scored match for an event into the library — and doubles as
 * the "refresh scores" action, since re-running it against an
 * already-imported event is exactly "re-fetch scores from the API and
 * update what changed." Idempotent either way: matches are looked up by
 * their deterministic id (so re-running updates instead of duplicating),
 * and `video`/`importedAt` are only ever set the first time a given match
 * is written, never overwritten by a later refresh.
 */
export async function importLibraryEvent(seasonId: string, eventCode: string): Promise<ImportSummary> {
  const season = getSeason(seasonId);

  // P15: a code that belongs to a manual event can never be imported from the API.
  const eventRef = doc(db, EVENTS, eventCode);
  const existingEvent = await getDoc(eventRef);
  if (existingEvent.exists() && originOf(existingEvent.data()) === "manual") {
    throw new Error(`${eventCode} is a manual event — it can't be imported from the FIRST API, and nothing in it will be overwritten.`);
  }

  const eventResult = await getEvent(eventCode, season.apiSeason);
  if (!eventResult.ok) throw new Error(eventResult.error.message);
  if (!eventResult.data) throw new Error(`No event found with code "${eventCode}" for the ${season.apiSeason} season.`);
  const eventName = eventResult.data.name;

  // P15: every imported event gets a libraryEvents doc too (origin 'api'), so event codes can be checked for collisions.
  const nowIso = new Date().toISOString();
  if (existingEvent.exists()) {
    await updateDoc(eventRef, { eventName, updatedAt: nowIso });
  } else {
    await setDoc(eventRef, {
      eventCode,
      eventName,
      seasonId,
      origin: "api",
      date: null,
      sourceUrl: null,
      defaultVideoUrl: null,
      createdBy: auth.currentUser?.uid ?? "",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  let imported = 0;
  let skipped = 0;
  const skippedManual: string[] = [];
  const types: MatchType[] = ["Practice", "Qualification", "Playoff"];
  for (const matchType of types) {
    const res = await getMatchesForEvent(eventCode, matchType, season.apiSeason);
    if (!res.ok) continue;
    for (const match of res.data) {
      if (match.redScore === null || match.blueScore === null) {
        skipped++;
        continue;
      }
      if (match.redTeams.length !== 2 || match.blueTeams.length !== 2) {
        skipped++;
        continue;
      }
      const id = libraryMatchId(eventCode, matchType, match.matchNumber);
      const ref = doc(db, COLLECTION, id);
      const existing = await getDoc(ref);
      // P15: never overwrite a manual match (firestore.rules refuses it too: `origin` is fixed).
      if (decideMatchWrite(existing.exists() ? existing.data() : null, "api") === "skip-other-origin") {
        skippedManual.push(id);
        continue;
      }
      const now = new Date().toISOString();
      await setDoc(
        ref,
        {
          seasonId,
          eventCode,
          eventName,
          matchType,
          matchNumber: match.matchNumber,
          alliances: {
            red: {
              teams: match.redTeams,
              score: match.redScore,
              penaltyPoints: match.redPenaltyPoints ?? 0,
              difficulty: getDifficulty(match.redScore),
            },
            blue: {
              teams: match.blueTeams,
              score: match.blueScore,
              penaltyPoints: match.bluePenaltyPoints ?? 0,
              difficulty: getDifficulty(match.blueScore),
            },
          },
          scoresUpdatedAt: now,
          origin: "api",
          // A new match is published; an existing one keeps whatever the admin chose, except a pre-P15 doc with no field yet.
          ...(existing.exists() ? (existing.data().published === undefined ? { published: true } : {}) : { video: null, importedAt: now, published: true }),
        },
        { merge: true }
      );
      imported++;
    }
  }
  return { eventName, imported, skipped, skippedManual };
}

/**
 * Realtime subscription to one event's library matches, sorted by match type then number.
 *
 * P15: by default only **published** matches (what scouts and every practice flow may
 * see). `includeUnpublished` is for the Admin Panel's tables — it reads everything,
 * which firestore.rules only allows for admins. Rules aren't filters, so the published
 * filter has to be part of the query itself.
 */
export function useLibraryMatches(eventCode: string | null, options: { includeUnpublished?: boolean } = {}) {
  const includeUnpublished = options.includeUnpublished ?? false;
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!eventCode || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches([]);
      setLoaded(true);
      return;
    }
    const base = collection(db, COLLECTION);
    const q = includeUnpublished ? query(base, where("eventCode", "==", eventCode)) : query(base, where("eventCode", "==", eventCode), where("published", "==", true));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LibraryMatch);
        next.sort((a, b) => (a.matchType === b.matchType ? a.matchNumber - b.matchNumber : a.matchType.localeCompare(b.matchType)));
        setMatches(next);
        setLoaded(true);
      },
      (err) => {
        console.error("libraryMatches (by event) subscription failed:", err);
        setMatches([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [eventCode, includeUnpublished]);

  return { matches, loaded };
}

/**
 * Realtime subscription to every library match in a season, across every
 * imported event — what Practice Scouting's Match Select (P4) shows, since
 * that flow has no event-select step of its own (just Season > Mode >
 * Difficulty > Match). Separate from `useLibraryMatches` (one event, for
 * the Admin Panel's per-event table) since the query key differs.
 */
export function useLibraryMatchesBySeason(seasonId: string | null) {
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!seasonId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches([]);
      setLoaded(true);
      return;
    }
    // P15: only published matches ever show up in a scout's match list — admins included.
    const q = query(collection(db, COLLECTION), where("seasonId", "==", seasonId), where("published", "==", true));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LibraryMatch);
        next.sort((a, b) => (a.matchType === b.matchType ? a.matchNumber - b.matchNumber : a.matchType.localeCompare(b.matchType)));
        setMatches(next);
        setLoaded(true);
      },
      (err) => {
        console.error("libraryMatches (by season) subscription failed:", err);
        setMatches([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [seasonId]);

  return { matches, loaded };
}

/**
 * P5: every library match, regardless of season/event — Scout Accuracy and
 * My Scouting label a practice session's match ("Q12", teams, etc.) from
 * its `libraryMatchId`, and a scout's sessions can span more than one
 * season/event, so no single-season/event query fits. The library is small
 * (one imported event's worth of matches today), so one unfiltered
 * subscription is simplest.
 */
export function useAllLibraryMatches(enabled: boolean = true, options: { includeUnpublished?: boolean } = {}) {
  // P15: published matches only, unless an admin-only screen (Rescore) needs the drafts too.
  const includeUnpublished = options.includeUnpublished ?? false;
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    // `enabled: false` (P13: a dashboard role that doesn't show practice matches) skips the subscription entirely.
    if (!enabled || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches([]);
      setLoaded(true);
      return;
    }
    const base = collection(db, COLLECTION);
    const unsubscribe = onSnapshot(
      includeUnpublished ? base : query(base, where("published", "==", true)),
      (snap) => {
        setMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LibraryMatch));
        setLoaded(true);
      },
      (err) => {
        console.error("libraryMatches (all) subscription failed:", err);
        setMatches([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [enabled, includeUnpublished]);

  return { matches, loaded };
}

export async function setLibraryMatchVideo(id: string, video: LibraryVideo | null): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { video });
}

export type VideoCsvRow = { matchKey: string; youtubeUrl: string; startSec: number; endSec: number };

/** Parses `matchKey,url,startSec,endSec` rows (optionally with that header on line 1 — skipped if present). */
export function parseVideoCsv(text: string): { rows: VideoCsvRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  const rows: VideoCsvRow[] = [];
  const startIndex = table[0]?.[0]?.trim().toLowerCase() === "matchkey" ? 1 : 0;

  for (let i = startIndex; i < table.length; i++) {
    const raw = table[i];
    const [matchKey, youtubeUrl, startSecStr, endSecStr] = raw;
    const startSec = Number(startSecStr);
    const endSec = Number(endSecStr);
    if (!matchKey || !youtubeUrl || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      errors.push(`Row ${i + 1}: couldn't read matchKey/url/startSec/endSec.`);
      continue;
    }
    rows.push({ matchKey: matchKey.trim(), youtubeUrl: youtubeUrl.trim(), startSec, endSec });
  }
  return { rows, errors };
}

export type VideoCsvResult = { updated: number; errors: string[] };

export async function importVideoCsv(text: string): Promise<VideoCsvResult> {
  const { rows, errors } = parseVideoCsv(text);
  let updated = 0;
  for (const row of rows) {
    try {
      await setLibraryMatchVideo(row.matchKey, { youtubeUrl: row.youtubeUrl, startSec: row.startSec, endSec: row.endSec });
      updated++;
    } catch {
      errors.push(`${row.matchKey}: no library match with this id.`);
    }
  }
  return { updated, errors };
}

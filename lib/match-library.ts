"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { getEvent, getMatchesForEvent } from "@/lib/ftc/actions";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { parseCsv } from "@/lib/analytics/csv";
import { getDifficulty, type Difficulty } from "@/lib/difficulty";
import { getSeason } from "@/lib/seasons";
import type { MatchType } from "@/lib/ftc/types";

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
};

const COLLECTION = "libraryMatches";

export function libraryMatchId(eventCode: string, matchType: MatchType, matchNumber: number): string {
  return `${eventCode}_${MATCH_TYPE_PREFIX[matchType]}${matchNumber}`;
}

export type ImportSummary = { eventName: string; imported: number; skipped: number };

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
  const eventResult = await getEvent(eventCode, season.apiSeason);
  if (!eventResult.ok) throw new Error(eventResult.error.message);
  if (!eventResult.data) throw new Error(`No event found with code "${eventCode}" for the ${season.apiSeason} season.`);
  const eventName = eventResult.data.name;

  let imported = 0;
  let skipped = 0;
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
          ...(existing.exists() ? {} : { video: null, importedAt: now }),
        },
        { merge: true }
      );
      imported++;
    }
  }
  return { eventName, imported, skipped };
}

/** Realtime subscription to one event's library matches, sorted by match type then number. */
export function useLibraryMatches(eventCode: string | null) {
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!eventCode || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, COLLECTION), where("eventCode", "==", eventCode));
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
  }, [eventCode]);

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
    const q = query(collection(db, COLLECTION), where("seasonId", "==", seasonId));
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
export function useAllLibraryMatches() {
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches([]);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      collection(db, COLLECTION),
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
  }, []);

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

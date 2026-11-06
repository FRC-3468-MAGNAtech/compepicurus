"use client";

import { useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch, type WriteBatch } from "firebase/firestore";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { getEvent } from "@/lib/ftc/actions";
import { generateManualEventCode, decideMatchWrite, originOf, validateEventCode, type LibraryOrigin } from "@/lib/library/ids";
import { buildManualMatchDoc, manualMatchId, type ValidMatch } from "@/lib/library/manual-match";
import { validateEventForm, type EventFormErrors, type EventFormInput } from "@/lib/library/event-form";
import { canonicalYouTubeUrl, parseYouTubeUrl } from "@/lib/library/youtube-url";
import { getSeason } from "@/lib/seasons";
import type { LibraryMatch, LibraryVideo } from "@/lib/match-library";
import type { TeamDoc } from "@/lib/team";

// Firestore side of hand-entered library matches and events (P15). The pure
// rules (validation, ids, which origin may write what) live in the other
// lib/library/ files and are unit tested; firestore.rules enforces the same
// things (origin can't change, a manual match must sit under a manual event).

const MATCHES = "libraryMatches";
const EVENTS = "libraryEvents";
/** Firestore allows 500 writes per batch; leave room for the audit entry. */
const BATCH_SIZE = 400;

export type Actor = { teamId: string; uid: string; name: string };

export type LibraryEvent = {
  eventCode: string;
  eventName: string;
  seasonId: string;
  origin: LibraryOrigin;
  date: string | null;
  sourceUrl: string | null;
  /** P15: one long stream reused for every match of this event, each with its own start/end. */
  defaultVideoUrl: string | null;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
};

const toEvent = (id: string, data: Record<string, unknown>): LibraryEvent => ({
  eventCode: id,
  eventName: typeof data.eventName === "string" ? data.eventName : id,
  seasonId: typeof data.seasonId === "string" ? data.seasonId : "",
  origin: originOf(data),
  date: typeof data.date === "string" ? data.date : null,
  sourceUrl: typeof data.sourceUrl === "string" ? data.sourceUrl : null,
  defaultVideoUrl: typeof data.defaultVideoUrl === "string" ? data.defaultVideoUrl : null,
  createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
  createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
  updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
});

/** Realtime list of every library event (API and manual), by name. */
export function useLibraryEvents() {
  const [events, setEvents] = useState<LibraryEvent[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const unsubscribe = onSnapshot(
      collection(db, EVENTS),
      (snap) => {
        setEvents(snap.docs.map((d) => toEvent(d.id, d.data())).sort((a, b) => a.eventName.localeCompare(b.eventName)));
        setLoaded(true);
      },
      (err) => {
        console.error("libraryEvents subscription failed:", err);
        setEvents([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, []);

  return { events, loaded };
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const audit = (batch: WriteBatch, actor: Actor, target: Record<string, unknown>, before: unknown = null, after: unknown = null) =>
  batch.set(newAuditLogRef(), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-match-library", target, before, after));

// --- events ---------------------------------------------------------------------------

export type CreateEventResult = { ok: true; event: LibraryEvent } | { ok: false; error: string; fieldErrors?: EventFormErrors };

/**
 * Creates a manual event. The code is the admin's own (checked against every
 * existing event, any existing matches under it, and — as a last guard —
 * the FIRST API, so it can never collide with a real event code) or a
 * generated `MAN-…` one. firestore.rules independently refuses a manual event
 * whose id is already taken by an API event (origin can't change).
 */
export async function createManualEvent(actor: Actor, input: EventFormInput, seasonId: string, existingEvents: LibraryEvent[]): Promise<CreateEventResult> {
  const checked = validateEventForm(input);
  if (!checked.ok) return { ok: false, error: "Fix the highlighted fields.", fieldErrors: checked.errors };

  const taken = new Set(existingEvents.map((e) => e.eventCode));
  const custom = input.code.trim() !== "";
  let code: string;
  if (custom) {
    const result = validateEventCode(input.code, taken);
    if (!result.ok) return { ok: false, error: result.error, fieldErrors: { code: result.error } };
    code = result.code;
  } else {
    code = generateManualEventCode(input.name, taken);
  }

  // Beyond the loaded list: a doc that arrived a moment ago, matches that exist under this code, or a real API event.
  const [existingDoc, existingMatches] = await Promise.all([getDoc(doc(db, EVENTS, code)), getDocs(query(collection(db, MATCHES), where("eventCode", "==", code)))]);
  if (existingDoc.exists() || !existingMatches.empty) {
    const error = `The code ${code} is already used by another event.`;
    return { ok: false, error, fieldErrors: custom ? { code: error } : undefined };
  }
  if (custom) {
    const api = await getEvent(code, getSeason(seasonId).apiSeason);
    if (api.ok && api.data) {
      const error = `${code} is a real FIRST event code (${api.data.name}). Pick a different one — manual events can't share a code with an API event.`;
      return { ok: false, error, fieldErrors: { code: error } };
    }
  }

  const now = new Date().toISOString();
  const event: LibraryEvent = {
    eventCode: code,
    eventName: input.name.trim(),
    seasonId,
    origin: "manual",
    date: input.date.trim() || null,
    sourceUrl: input.sourceUrl.trim() || null,
    defaultVideoUrl: normalizeVideoUrl(input.defaultVideoUrl),
    createdBy: actor.uid,
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, EVENTS, code), event);
  audit(batch, actor, { op: "create-event", eventCode: code }, null, { eventName: event.eventName, seasonId });
  try {
    await batch.commit();
  } catch (err) {
    console.error("couldn't create the manual event:", err);
    return { ok: false, error: "Couldn't save the event. Check your connection, and that the code isn't already used." };
  }
  return { ok: true, event };
}

function normalizeVideoUrl(value: string): string | null {
  const parsed = parseYouTubeUrl(value);
  return parsed ? canonicalYouTubeUrl(parsed.videoId) : null;
}

/** Edits a manual event's details; a new name is copied onto the denormalized `eventName` of every match under it. */
export async function updateManualEvent(
  actor: Actor,
  event: LibraryEvent,
  patch: Pick<EventFormInput, "name" | "date" | "sourceUrl" | "defaultVideoUrl">,
  matchIds: string[]
): Promise<void> {
  const now = new Date().toISOString();
  const next = {
    eventName: patch.name.trim(),
    date: patch.date.trim() || null,
    sourceUrl: patch.sourceUrl.trim() || null,
    defaultVideoUrl: normalizeVideoUrl(patch.defaultVideoUrl),
    updatedAt: now,
  };
  const first = writeBatch(db);
  first.update(doc(db, EVENTS, event.eventCode), next);
  audit(first, actor, { op: "edit-event", eventCode: event.eventCode }, { eventName: event.eventName, date: event.date, sourceUrl: event.sourceUrl, defaultVideoUrl: event.defaultVideoUrl }, next);
  await first.commit();
  if (next.eventName !== event.eventName) {
    for (const ids of chunk(matchIds, BATCH_SIZE)) {
      const batch = writeBatch(db);
      for (const id of ids) batch.update(doc(db, MATCHES, id), { eventName: next.eventName, updatedAt: now });
      await batch.commit();
    }
  }
}

export async function deleteManualEvent(actor: Actor, event: LibraryEvent): Promise<void> {
  const remaining = await getDocs(query(collection(db, MATCHES), where("eventCode", "==", event.eventCode)));
  if (!remaining.empty) throw new Error("Delete this event's matches first.");
  const batch = writeBatch(db);
  batch.delete(doc(db, EVENTS, event.eventCode));
  audit(batch, actor, { op: "delete-event", eventCode: event.eventCode }, { eventName: event.eventName }, null);
  await batch.commit();
}

// --- matches --------------------------------------------------------------------------

export type UpsertOptions = {
  /** `published` for matches that don't exist yet (existing ones keep theirs). */
  newPublished: boolean;
  /** `needsReview` for matches that don't exist yet (CSV/paste imports start as true). */
  newNeedsReview: boolean;
};

export type UpsertResult = { created: number; updated: number; skipped: { id: string; reason: string }[]; ids: string[] };

/**
 * Creates or replaces manual matches under one event. The shared rule runs
 * first (`decideMatchWrite`): an existing **API** match with the same id is never
 * touched and is reported as skipped — and firestore.rules would refuse it
 * anyway. A match listed twice keeps the last one. Difficulty is recomputed
 * from the typed scores every time (buildManualMatchFields).
 */
export async function upsertManualMatches(actor: Actor, event: LibraryEvent, matches: ValidMatch[], options: UpsertOptions): Promise<UpsertResult> {
  const existingSnap = await getDocs(query(collection(db, MATCHES), where("eventCode", "==", event.eventCode)));
  const existing = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

  const byId = new Map<string, ValidMatch>();
  for (const m of matches) byId.set(manualMatchId(event, m), m);

  const now = new Date().toISOString();
  const writes: { id: string; data: Record<string, unknown> }[] = [];
  const skipped: UpsertResult["skipped"] = [];
  let created = 0;
  let updated = 0;
  const ref = { eventCode: event.eventCode, eventName: event.eventName, seasonId: event.seasonId };

  for (const [id, match] of byId) {
    const current = existing.get(id) ?? null;
    const decision = decideMatchWrite(current, "manual");
    if (decision === "skip-other-origin") {
      skipped.push({ id, reason: "An imported (API) match with this id exists, and manual entry never overwrites one." });
      continue;
    }
    writes.push({ id, data: buildManualMatchDoc(match, ref, current, options, actor.uid, now) });
    if (decision === "create") created++;
    else updated++;
  }

  const groups = chunk(writes, BATCH_SIZE);
  for (let i = 0; i < groups.length; i++) {
    const batch = writeBatch(db);
    for (const w of groups[i]) batch.set(doc(db, MATCHES, w.id), w.data);
    if (i === 0) audit(batch, actor, { op: "upsert-matches", eventCode: event.eventCode }, null, { created, updated, skipped: skipped.length });
    await batch.commit();
  }
  if (groups.length === 0 && skipped.length > 0) {
    const batch = writeBatch(db);
    audit(batch, actor, { op: "upsert-matches", eventCode: event.eventCode }, null, { created: 0, updated: 0, skipped: skipped.length });
    await batch.commit();
  }
  return { created, updated, skipped, ids: writes.map((w) => w.id) };
}

async function patchMatches(actor: Actor, ids: string[], patch: Record<string, unknown>, target: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const groups = chunk(ids, BATCH_SIZE);
  for (let i = 0; i < groups.length; i++) {
    const batch = writeBatch(db);
    for (const id of groups[i]) batch.update(doc(db, MATCHES, id), { ...patch, updatedAt: now });
    if (i === 0) audit(batch, actor, { ...target, count: ids.length, matchIds: ids.slice(0, 50) }, null, patch);
    await batch.commit();
  }
}

/** Publishing also clears "Needs review" — the admin has looked at it. */
export const setMatchesPublished = (actor: Actor, ids: string[], published: boolean) =>
  patchMatches(actor, ids, { published, needsReview: false }, { op: published ? "publish-matches" : "unpublish-matches" });

/**
 * Sets one YouTube link on many matches. Each keeps its own start and end times
 * (FIX3: times are optional, so a match with none simply keeps none — it plays
 * from the beginning to the end of the video).
 */
export async function setMatchesVideoLink(actor: Actor, matches: Pick<LibraryMatch, "id" | "video">[], videoId: string): Promise<void> {
  const now = new Date().toISOString();
  const youtubeUrl = canonicalYouTubeUrl(videoId);
  const groups = chunk(matches, BATCH_SIZE);
  for (let i = 0; i < groups.length; i++) {
    const batch = writeBatch(db);
    for (const m of groups[i]) {
      const video: LibraryVideo = { youtubeUrl, startSec: m.video?.startSec ?? null, endSec: m.video?.endSec ?? null };
      batch.update(doc(db, MATCHES, m.id), { video, updatedAt: now });
    }
    if (i === 0) audit(batch, actor, { op: "set-video", count: matches.length, matchIds: matches.slice(0, 50).map((m) => m.id) }, null, { youtubeUrl });
    await batch.commit();
  }
}

export async function deleteManualMatches(actor: Actor, ids: string[]): Promise<void> {
  const groups = chunk(ids, BATCH_SIZE);
  for (let i = 0; i < groups.length; i++) {
    const batch = writeBatch(db);
    for (const id of groups[i]) batch.delete(doc(db, MATCHES, id));
    if (i === 0) audit(batch, actor, { op: "delete-matches", count: ids.length, matchIds: ids.slice(0, 50) });
    await batch.commit();
  }
}

/** How many *completed* practice sessions this team has scored against a match — for the "editing scores will change their accuracy" warning. */
export async function countCompletedSessionsForMatch(teamId: string, matchId: string): Promise<number> {
  const snap = await getDocs(query(collection(db, "practiceSessions"), where("teamId", "==", teamId), where("libraryMatchId", "==", matchId)));
  return snap.docs.filter((d) => d.data().status === "completed").length;
}

// --- one-time backfill of pre-P15 docs ----------------------------------------------------

export type BackfillResult = { matchesStamped: number; eventsCreated: number };

/**
 * Pre-P15 library docs have no `origin` or `published`. Members now only read
 * `published == true` (firestore.rules), so they'd vanish from practice flows
 * until stamped. This stamps every such doc `origin: 'api'`, `published: true`,
 * and creates the `libraryEvents` doc each API event now has. Idempotent;
 * admin-only (rules). Safe to run again.
 */
export async function backfillLibraryMetadata(actor: Pick<Actor, "uid">): Promise<BackfillResult> {
  const [matchSnap, eventSnap] = await Promise.all([getDocs(collection(db, MATCHES)), getDocs(collection(db, EVENTS))]);
  const knownEvents = new Set(eventSnap.docs.map((d) => d.id));

  const needStamp = matchSnap.docs.filter((d) => d.data().origin === undefined || d.data().published === undefined);
  for (const group of chunk(needStamp, BATCH_SIZE)) {
    const batch = writeBatch(db);
    for (const d of group) batch.update(d.ref, { origin: originOf(d.data()), published: d.data().published ?? true });
    await batch.commit();
  }

  const missing = new Map<string, LibraryMatch>();
  for (const d of matchSnap.docs) {
    const m = d.data() as LibraryMatch;
    if (originOf(m) === "api" && m.eventCode && !knownEvents.has(m.eventCode) && !missing.has(m.eventCode)) missing.set(m.eventCode, m);
  }
  const now = new Date().toISOString();
  for (const [eventCode, m] of missing) {
    await setDoc(doc(db, EVENTS, eventCode), {
      eventCode,
      eventName: m.eventName,
      seasonId: m.seasonId,
      origin: "api",
      date: null,
      sourceUrl: null,
      defaultVideoUrl: null,
      createdBy: actor.uid,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { matchesStamped: needStamp.length, eventsCreated: missing.size };
}

/**
 * Runs the backfill once per team, the first time an admin has the app open
 * after P15 ships (flagged on the team doc so it isn't repeated every login).
 * Mount it for admins only.
 */
export function useLibraryBackfill(teamId: string | null, uid: string | null, team: Pick<TeamDoc, "libraryBackfilled"> | null, teamLoaded: boolean) {
  const started = useRef(false);
  useEffect(() => {
    if (!teamId || !uid || !teamLoaded || !team || team.libraryBackfilled === true || started.current || !isFirebaseConfigured()) return;
    started.current = true;
    backfillLibraryMetadata({ uid })
      .then(() => updateDoc(doc(db, "teams", teamId), { libraryBackfilled: true }))
      .catch((err) => {
        console.error("library backfill failed:", err);
        started.current = false;
      });
  }, [teamId, uid, team, teamLoaded]);
}

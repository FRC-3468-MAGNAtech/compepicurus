"use client";

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchType } from "@/lib/ftc/types";
import type { RotationPattern, ScheduleSlot } from "@/lib/scheduler/types";

export type AssignmentMatchSource = "event" | "practice" | "live";

export type AssignmentSettings = {
  matchSource: AssignmentMatchSource;
  /** Practice-library source only. */
  seasonId: string | null;
  difficulty: Difficulty | null;
  rangesText: string;
  categories: MatchType[];
  pattern: RotationPattern;
  intervalSize: number | null;
  scoutUids: string[];
  prioritizedTeams: number[];
  seed: number;
};

export type AssignmentVersion = {
  generatedBy: string;
  /** ISO. */
  generatedAt: string;
  settings: AssignmentSettings;
  slots: ScheduleSlot[];
  counts: Record<string, number>;
  fair: boolean;
  warning: string | null;
};

export type AssignmentsDoc = {
  id: string;
  teamId: string;
  eventCode: string;
  current: AssignmentVersion | null;
  previous: AssignmentVersion | null;
};

const COLLECTION = "assignments";

function docId(teamId: string, eventCode: string): string {
  return `${teamId}_${eventCode}`;
}

/** Realtime — the Assignments page, Match Scout Form's "next assignment," and the Dashboard/My Scouting "upcoming assignments" card all read this. */
export function useAssignments(teamId: string | null, eventCode: string | null) {
  const [assignments, setAssignments] = useState<AssignmentsDoc | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !eventCode || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssignments(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, COLLECTION, docId(teamId, eventCode)),
      (snap) => {
        setAssignments(snap.exists() ? ({ id: snap.id, ...snap.data() } as AssignmentsDoc) : null);
        setLoaded(true);
      },
      (err) => {
        console.error("assignments subscription failed:", err);
        setAssignments(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, eventCode]);

  return { assignments, loaded };
}

/** Admin-only. Publishing keeps the prior `current` as `previous` — one level of undo, per the prompt. */
export async function publishAssignments(teamId: string, eventCode: string, version: AssignmentVersion): Promise<void> {
  const ref = doc(db, COLLECTION, docId(teamId, eventCode));
  const existing = await getDoc(ref);
  const previous = existing.exists() ? ((existing.data() as AssignmentsDoc).current ?? null) : null;
  await setDoc(ref, { teamId, eventCode, current: version, previous, updatedAt: serverTimestamp() });
}

/** Admin-only. Swaps `current` back to `previous`, clearing `previous` (a single level of undo, not a full history). */
export async function undoAssignments(teamId: string, eventCode: string): Promise<void> {
  const ref = doc(db, COLLECTION, docId(teamId, eventCode));
  const existing = await getDoc(ref);
  if (!existing.exists()) return;
  const data = existing.data() as AssignmentsDoc;
  if (!data.previous) return;
  await updateDoc(ref, { current: data.previous, previous: null });
}

/**
 * One manual cell edit — re-point a single slot at a different scout (or
 * clear it with `null`). Read-modify-write on the whole `slots` array since
 * Firestore has no indexed-array-element update.
 */
export async function swapAssignmentSlot(
  teamId: string,
  eventCode: string,
  matchType: MatchType,
  matchNumber: number,
  slot: ScheduleSlot["slot"],
  newScoutUid: string | null
): Promise<void> {
  const ref = doc(db, COLLECTION, docId(teamId, eventCode));
  const existing = await getDoc(ref);
  if (!existing.exists()) return;
  const data = existing.data() as AssignmentsDoc;
  if (!data.current) return;

  const slots = data.current.slots.map((s) => (s.matchType === matchType && s.matchNumber === matchNumber && s.slot === slot ? { ...s, scoutUid: newScoutUid } : s));
  const counts: Record<string, number> = {};
  for (const uid of Object.keys(data.current.counts)) counts[uid] = 0;
  for (const s of slots) if (s.scoutUid) counts[s.scoutUid] = (counts[s.scoutUid] ?? 0) + 1;
  const values = Object.values(counts);
  const fair = values.length === 0 || Math.max(...values) - Math.min(...values) <= 1;

  await updateDoc(ref, {
    "current.slots": slots,
    "current.counts": counts,
    "current.fair": fair,
    "current.warning": fair ? null : `Assignment counts range from ${Math.min(...values)} to ${Math.max(...values)} after this edit.`,
  });
}

/** A manual swap's warnings, computed *before* writing — the UI shows these in a confirm step rather than blocking the edit outright (the prompt says "warn," not "block"). */
export function evaluateSlotSwap(
  version: AssignmentVersion,
  matchType: MatchType,
  matchNumber: number,
  slot: ScheduleSlot["slot"],
  newScoutUid: string | null
): { warnings: string[] } {
  const warnings: string[] = [];
  if (newScoutUid === null) return { warnings };

  const sameMatchOther = version.slots.some(
    (s) => s.matchType === matchType && s.matchNumber === matchNumber && s.slot !== slot && s.scoutUid === newScoutUid
  );
  if (sameMatchOther) warnings.push("This scout is already assigned to another robot in this same match.");

  const counts: Record<string, number> = { ...version.counts };
  const existingSlot = version.slots.find((s) => s.matchType === matchType && s.matchNumber === matchNumber && s.slot === slot);
  if (existingSlot?.scoutUid) counts[existingSlot.scoutUid] = (counts[existingSlot.scoutUid] ?? 1) - 1;
  counts[newScoutUid] = (counts[newScoutUid] ?? 0) + 1;
  const values = Object.values(counts);
  if (values.length > 0 && Math.max(...values) - Math.min(...values) > 1) {
    warnings.push("This swap would make the assignment counts uneven by more than 1.");
  }

  return { warnings };
}

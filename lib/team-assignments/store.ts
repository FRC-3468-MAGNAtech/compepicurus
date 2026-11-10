"use client";

import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { FormEntryType } from "@/lib/form-entries-model";
import { assignedTeamCounts, parseTeamAssignmentsDoc, type TeamAssignKind, type TeamAssignmentsDoc, type TeamAssignVersion } from "@/lib/team-assignments/model";

// P31: persistence for the Pit Scouting and Team Strategy assignments: `assignments/{teamId}_{eventCode}_{pit|teamStrategy}`, next to Match Scouting's
// `assignments/{teamId}_{eventCode}`. Everyone on the team reads (as a team-scoped query); only people with Assignments page access write (firestore.rules).

const COLLECTION = "assignments";

export const teamAssignmentDocId = (teamId: string, eventCode: string, kind: TeamAssignKind): string => `${teamId}_${eventCode}_${kind}`;

/**
 * Every Pit Scouting / Team Strategy assignment doc of the team, live: one query for all events and both kinds (a document that doesn't exist yet can't be read
 * directly under the rules, and the notification, dashboard, form and Scout Status all want several).
 */
export function useTeamAssignmentDocs(teamId: string | null): { docs: TeamAssignmentsDoc[]; loaded: boolean } {
  const [held, setHeld] = useState<{ teamId: string; docs: TeamAssignmentsDoc[] } | null>(null);
  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) return;
    return onSnapshot(
      query(collection(db, COLLECTION), where("teamId", "==", teamId)),
      (snap) => setHeld({ teamId, docs: snap.docs.map((d) => parseTeamAssignmentsDoc(d.id, d.data())).filter((d): d is TeamAssignmentsDoc => d !== null) }),
      (err) => {
        reportFirestoreError("team assignments subscription failed", err, `assignments where teamId == ${teamId}`);
        setHeld({ teamId, docs: [] });
      }
    );
  }, [teamId]);
  if (!teamId || !isFirebaseConfigured()) return { docs: [], loaded: true };
  return held?.teamId === teamId ? { docs: held.docs, loaded: true } : { docs: [], loaded: false };
}

/** One event's doc of one kind, from the shared subscription's list. */
export const findTeamAssignments = (docs: readonly TeamAssignmentsDoc[], eventCode: string | null, kind: TeamAssignKind): TeamAssignmentsDoc | null => docs.find((d) => d.eventCode === eventCode && d.kind === kind) ?? null;

/** Teams per scout (the Scout Status target prefill), added up over the given events. Null when no event has a published version for this kind. */
export function useAssignedTeamCounts(teamId: string | null, eventCodes: readonly string[], kind: TeamAssignKind): ReadonlyMap<string, number> | null {
  const { docs } = useTeamAssignmentDocs(teamId);
  return useMemo(() => assignedTeamCounts(docs, eventCodes, kind), [docs, eventCodes, kind]);
}

/**
 * Publishes a version: the old `current` becomes `previous` (one level of undo, like Match Scouting). Pass the doc as the page last saw it so the first publish
 * needs no read of a document that doesn't exist yet.
 */
export async function publishTeamAssignments(teamId: string, eventCode: string, kind: TeamAssignKind, version: TeamAssignVersion, existing: TeamAssignmentsDoc | null): Promise<void> {
  await setDoc(doc(db, COLLECTION, teamAssignmentDocId(teamId, eventCode, kind)), { teamId, eventCode, kind, current: version, previous: existing?.current ?? null, updatedAt: serverTimestamp() });
}

/** Swaps `current` back to `previous` (and clears `previous`). */
export async function undoTeamAssignments(teamId: string, eventCode: string, kind: TeamAssignKind, existing: TeamAssignmentsDoc): Promise<void> {
  if (!existing.previous) return;
  await setDoc(doc(db, COLLECTION, teamAssignmentDocId(teamId, eventCode, kind)), { teamId, eventCode, kind, current: existing.previous, previous: null, updatedAt: serverTimestamp() });
}

/** The form entry type each kind is done with. */
export const KIND_FORM_TYPE: Record<TeamAssignKind, FormEntryType> = { pit: "pit-scout", teamStrategy: "team-strategy" };

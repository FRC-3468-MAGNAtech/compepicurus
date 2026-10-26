"use client";

import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";

/**
 * Who's attending which event, one doc per (team, event) — owned by the
 * Assignments page (P6). P5 guessed a different (one-doc-per-uid) shape
 * for this collection before P6's own spec existed; this is the real
 * shape, per P6's explicit "Saved to eventAttendance/{teamId}_{eventCode}
 * (list of uids)" — see docs/ASSUMPTIONS.md (P6) for the reconciliation.
 */
export type EventAttendance = {
  /** `${teamId}_${eventCode}`. */
  id: string;
  teamId: string;
  eventCode: string;
  uids: string[];
  updatedAt: unknown;
};

const COLLECTION = "eventAttendance";

function docId(teamId: string, eventCode: string): string {
  return `${teamId}_${eventCode}`;
}

/** Admin-gated at the call site (Assignments page) via usePermissions(); also enforced in firestore.rules. */
export async function setEventAttendance(teamId: string, eventCode: string, uids: string[]): Promise<void> {
  await setDoc(doc(db, COLLECTION, docId(teamId, eventCode)), {
    teamId,
    eventCode,
    uids,
    updatedAt: serverTimestamp(),
  });
}

/** Realtime, every event this team has attendance recorded for — what Scout Accuracy's Event filter and the stats engine read. */
export function useTeamEventAttendance(teamId: string | null) {
  const [attendance, setAttendance] = useState<EventAttendance[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAttendance([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, COLLECTION), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setAttendance(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EventAttendance));
        setLoaded(true);
      },
      (err) => {
        console.error("eventAttendance subscription failed:", err);
        setAttendance([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { attendance, loaded };
}

/** Realtime, one event's attendance doc — what the Assignments page's own attendance checklist reads/edits. */
export function useEventAttendance(teamId: string | null, eventCode: string | null) {
  const [attendance, setAttendance] = useState<EventAttendance | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !eventCode || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAttendance(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, COLLECTION, docId(teamId, eventCode)),
      (snap) => {
        setAttendance(snap.exists() ? ({ id: snap.id, ...snap.data() } as EventAttendance) : null);
        setLoaded(true);
      },
      (err) => {
        console.error("eventAttendance (single) subscription failed:", err);
        setAttendance(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, eventCode]);

  return { attendance, loaded };
}

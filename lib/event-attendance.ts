"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";

/**
 * P5: who's attending which event — owned by the Assignments page (P6),
 * which doesn't exist yet. This collection has no writer at all right now;
 * `useEventAttendance` simply returns an empty list until P6 ships, which a
 * plain Firestore query already does naturally (zero matching documents is
 * zero matching documents — no "collection doesn't exist" special case
 * needed). Scout Accuracy's Event filter reads this to know who's
 * attending a given event; see docs/ASSUMPTIONS.md (P5) for why the
 * filter's own event *options* come from `scoutEntries` instead.
 */
export type EventAttendance = {
  id: string;
  teamId: string;
  uid: string;
  eventCode: string;
};

const COLLECTION = "eventAttendance";

export function useEventAttendance(teamId: string | null) {
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

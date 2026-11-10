"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { AssignmentsDoc } from "@/lib/assignments";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { ScheduleSlot } from "@/lib/scheduler/types";

/**
 * Every event's published schedule slots for the team, by event code — one
 * team-scoped query rather than one document read per event (a document that
 * does not exist yet cannot be read directly under firestore.rules, and Scout
 * Status looks at several events at once).
 */
export function useTeamAssignmentSlots(teamId: string | null): { slotsByEvent: Map<string, ScheduleSlot[]>; loaded: boolean } {
  const [slotsByEvent, setSlotsByEvent] = useState<Map<string, ScheduleSlot[]>>(new Map());
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlotsByEvent(new Map());
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      query(collection(db, "assignments"), where("teamId", "==", teamId)),
      (snap) => {
        // P31: the Pit Scouting / Team Strategy docs (they have a `kind`) share the collection; only the Match Scouting schedule has slots
        setSlotsByEvent(new Map(snap.docs.filter((d) => d.data().kind === undefined).map((d) => [String(d.data().eventCode), ((d.data() as AssignmentsDoc).current?.slots ?? []) as ScheduleSlot[]])));
        setLoaded(true);
      },
      (err) => {
        reportFirestoreError("assignments (team) subscription failed", err, `assignments where teamId == ${teamId}`);
        setSlotsByEvent(new Map());
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { slotsByEvent, loaded };
}

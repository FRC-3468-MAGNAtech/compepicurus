"use client";

import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { describeFirestoreError, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { CATEGORY_IDS, type StatusCategory } from "@/lib/scout-status/categories";
import { EMPTY_SETUP, type EventSetup } from "@/lib/scout-status/compute";

// Persistence for the Scout Status setup (P16): one doc per event,
// `scoutTargets/{teamId}_{eventCode}`, realtime for everyone. Members read; admins
// and Lead Scouts write (firestore.rules' canEditScoutTargets()).

const COLLECTION = "scoutTargets";

export const scoutTargetsId = (teamId: string, eventCode: string): string => `${teamId}_${eventCode}`;

/** A stored doc as an EventSetup, defensively — anything malformed is dropped rather than crashing the page. */
export function setupFromData(data: Record<string, unknown> | undefined): EventSetup {
  if (!data) return EMPTY_SETUP;
  const ranges: EventSetup["ranges"] = {};
  const rawRanges = (data.ranges ?? {}) as Record<string, unknown>;
  for (const c of CATEGORY_IDS) if (typeof rawRanges[c] === "string") ranges[c] = rawRanges[c] as string;

  const maxOverrides: EventSetup["maxOverrides"] = {};
  const rawMax = (data.maxOverrides ?? {}) as Record<string, unknown>;
  for (const c of CATEGORY_IDS) if (typeof rawMax[c] === "number") maxOverrides[c] = rawMax[c] as number;

  const individual: EventSetup["individual"] = {};
  const rawIndividual = (data.individual ?? {}) as Record<string, unknown>;
  for (const [uid, cats] of Object.entries(rawIndividual)) {
    if (!cats || typeof cats !== "object") continue;
    const row: Partial<Record<StatusCategory, number>> = {};
    for (const c of CATEGORY_IDS) {
      const v = (cats as Record<string, unknown>)[c];
      if (typeof v === "number") row[c] = v;
    }
    individual[uid] = row;
  }

  const extraScouts = Array.isArray(data.extraScouts) ? data.extraScouts.filter((u): u is string => typeof u === "string") : [];

  // P30: teams-per-scout targets for Pit Scout and Team Strategy (absent on older docs)
  const teamTargets: NonNullable<EventSetup["teamTargets"]> = {};
  const rawTeam = (data.teamTargets ?? {}) as Record<string, unknown>;
  for (const type of ["pit-scout", "team-strategy"] as const) {
    const t = rawTeam[type];
    if (!t || typeof t !== "object") continue;
    const all = (t as Record<string, unknown>).all;
    const individual: Record<string, number> = {};
    for (const [uid, v] of Object.entries(((t as Record<string, unknown>).individual ?? {}) as Record<string, unknown>)) if (typeof v === "number") individual[uid] = v;
    teamTargets[type] = { ...(typeof all === "number" ? { all } : {}), individual };
  }
  return { ranges, maxOverrides, individual, extraScouts, ...(Object.keys(teamTargets).length > 0 ? { teamTargets } : {}) };
}

/** Realtime setups for every event of the team, by event code. Read as a team-scoped query (rules are not filters, and a doc that does not exist yet cannot be read directly). */
export function useScoutTargets(teamId: string | null) {
  const [setups, setSetups] = useState<Map<string, EventSetup>>(new Map());
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  const [error, setError] = useState<FirestoreFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSetups(new Map());
      setLoaded(true);
      return;
    }
    setError(null);
    const unsubscribe = onSnapshot(
      query(collection(db, COLLECTION), where("teamId", "==", teamId)),
      (snap) => {
        setSetups(new Map(snap.docs.map((d) => [String(d.data().eventCode), setupFromData(d.data())])));
        setLoaded(true);
      },
      (err) => {
        reportFirestoreError("scoutTargets subscription failed", err, `scoutTargets where teamId == ${teamId}`);
        setError(describeFirestoreError("Couldn't load the scout targets", err, `scoutTargets where teamId == ${teamId}`));
        setSetups(new Map());
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, attempt]);

  return useMemo(() => ({ setups, loaded, error, retry: () => setAttempt((n) => n + 1) }), [setups, loaded, error]);
}

/** Saves one event's whole setup (replacing the doc). */
export async function saveScoutTargets(actor: { teamId: string; uid: string }, eventCode: string, setup: EventSetup): Promise<void> {
  await setDoc(doc(db, COLLECTION, scoutTargetsId(actor.teamId, eventCode)), {
    teamId: actor.teamId,
    eventCode,
    ranges: setup.ranges,
    maxOverrides: setup.maxOverrides,
    individual: setup.individual,
    extraScouts: setup.extraScouts,
    ...(setup.teamTargets && Object.keys(setup.teamTargets).length > 0 ? { teamTargets: setup.teamTargets } : {}),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
}

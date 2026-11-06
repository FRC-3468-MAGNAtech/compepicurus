"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { describeFirestoreError, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { applyCreditsOp, describeOp, sameSections, sanitizeSections, type CreditSection, type CreditsOp } from "@/lib/credits/ops";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";

// Persistence for the Credits page (P14): one doc, `credits/{teamId}`.

const COLLECTION = "credits";

type Actor = { teamId: string; uid: string; name: string };

/**
 * Applies one edit **inside a Firestore transaction**: read the latest stored
 * sections (or the defaults, if nothing has been saved yet), apply the op to
 * *that*, write the result back with an audit entry in the same transaction.
 * Replaying the op on whatever is stored at commit time — and Firestore
 * retrying if the doc changed underneath — means two admins editing at once
 * compose instead of one overwriting the other. Returns false (writing nothing)
 * when the op changes nothing, e.g. editing something another admin already deleted.
 */
export async function editCredits(actor: Actor, op: CreditsOp): Promise<boolean> {
  const ref = doc(db, COLLECTION, actor.teamId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists() ? sanitizeSections(snap.data().sections) : DEFAULT_CREDITS;
    const after = applyCreditsOp(before, op);
    if (sameSections(before, after)) return false;

    tx.set(ref, { teamId: actor.teamId, sections: after, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp() });
    tx.set(newAuditLogRef(), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-credits", describeOp(op), null, null));
    return true;
  });
}

/**
 * Realtime credits for the team, falling back to the default sections while no
 * doc exists. The optimistic list, if any, is pinned to the snapshot it was
 * computed from — a newer snapshot (ours landing, or another admin's edit)
 * replaces it, so it never masks someone else's change or lingers.
 */
export function useCredits(teamId: string | null) {
  const [stored, setStored] = useState<CreditSection[] | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  const [optimistic, setOptimistic] = useState<{ sections: CreditSection[]; base: CreditSection[] | null } | null>(null);
  // FIX3: a failed load is reported, not disguised as "no credits saved yet" (which would silently show the starter list instead of the saved one).
  const [error, setError] = useState<FirestoreFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStored(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setError(null);
    const unsubscribe = onSnapshot(
      doc(db, COLLECTION, teamId),
      (snap) => {
        setStored(snap.exists() ? sanitizeSections(snap.data().sections) : null);
        setLoaded(true);
      },
      (err) => {
        reportFirestoreError("credits subscription failed", err, `credits/${teamId}`);
        setError(describeFirestoreError("Couldn't load credits", err, `credits/${teamId}`));
        setStored(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, attempt]);

  const server = stored ?? DEFAULT_CREDITS;
  const sections = optimistic && optimistic.base === stored ? optimistic.sections : server;

  const edit = useCallback(
    async (actor: { uid: string; name: string } | null, op: CreditsOp): Promise<boolean> => {
      if (!teamId || !actor) return false;
      setOptimistic({ sections: applyCreditsOp(sections, op), base: stored });
      try {
        const changed = await editCredits({ teamId, uid: actor.uid, name: actor.name }, op);
        // Nothing was written (the op was stale), so no snapshot is coming to replace the optimistic list — drop it now.
        if (!changed) setOptimistic(null);
        return true;
      } catch (err) {
        console.error("credits edit failed:", err);
        setOptimistic(null);
        return false;
      }
    },
    [teamId, sections, stored]
  );

  return { sections, isDefault: stored === null, loaded, edit, error, retry: () => setAttempt((n) => n + 1) };
}

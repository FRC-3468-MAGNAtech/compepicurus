"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { applyPickOp, samePicks, sanitizePicks, type PickOp } from "@/lib/pick-list/ops";

// Persistence for the shared Pick List board (P12): `pickLists/{teamId}_{eventCode}`.

export type PickListDoc = {
  teamId: string;
  eventCode: string;
  /** Teams we plan to pick, in priority order (index 0 = first choice). */
  picked: number[];
  updatedBy: string | null;
  updatedByName: string | null;
  /** Milliseconds, or null while the server timestamp is still pending. */
  updatedAtMs: number | null;
};

const COLLECTION = "pickLists";

export function pickListId(teamId: string, eventCode: string): string {
  return `${teamId}_${eventCode}`;
}

/**
 * Applies one edit to the list **inside a Firestore transaction**: read the
 * latest stored list, apply the op to *that*, write it back (plus an audit
 * entry in the same transaction). Because the op is replayed on whatever is
 * stored at commit time — and Firestore retries the transaction if the doc
 * changed underneath it — two people editing at once compose instead of one
 * overwriting the other. Returns false (and writes nothing) if the op changes
 * nothing, e.g. adding a team someone else already added.
 */
export async function editPickList(ctx: { teamId: string; eventCode: string; uid: string; name: string }, op: PickOp): Promise<boolean> {
  const ref = doc(db, COLLECTION, pickListId(ctx.teamId, ctx.eventCode));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const before = sanitizePicks(snap.exists() ? snap.data().picked : []);
    const after = applyPickOp(before, op);
    if (samePicks(before, after)) return false;

    tx.set(ref, {
      teamId: ctx.teamId,
      eventCode: ctx.eventCode,
      picked: after,
      updatedBy: ctx.uid,
      updatedByName: ctx.name,
      updatedAt: serverTimestamp(),
    });
    // The audit trail rides in the same transaction, so a change can never land unlogged.
    tx.set(newAuditLogRef(), buildAuditEntry(ctx.teamId, ctx.uid, ctx.name, "edit-pick-list", { eventCode: ctx.eventCode, op: op.type }, { picked: before }, { picked: after }));
    return true;
  });
}

/**
 * Realtime pick list for one team+event, plus an `edit()` that applies an op
 * transactionally and shows its result immediately.
 *
 * The optimistic list is pinned to the server list it was computed from: the
 * moment a newer snapshot arrives (ours landing, or anyone else's edit) it is
 * discarded and the server's list is shown, so it can never mask a teammate's
 * change or linger.
 */
export function usePickList(teamId: string | null, eventCode: string | null, actor: { uid: string; name: string } | null) {
  const [list, setList] = useState<PickListDoc | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  const [optimistic, setOptimistic] = useState<{ picks: number[]; base: PickListDoc | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId || !eventCode || !isFirebaseConfigured()) {
      // Deliberate: clears the previous event's list when there's no event/team to show.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setList(null);
      setLoaded(true);
      return;
    }
    // A new event's list isn't loaded until its first snapshot — don't flash the previous one.
    setLoaded(false);
    const unsubscribe = onSnapshot(
      doc(db, COLLECTION, pickListId(teamId, eventCode)),
      (snap) => {
        if (!snap.exists()) {
          setList(null);
        } else {
          const data = snap.data();
          const updatedAt = data.updatedAt as { toMillis?: () => number } | null | undefined;
          setList({
            teamId: data.teamId,
            eventCode: data.eventCode,
            picked: sanitizePicks(data.picked),
            updatedBy: data.updatedBy ?? null,
            updatedByName: data.updatedByName ?? null,
            updatedAtMs: updatedAt?.toMillis ? updatedAt.toMillis() : null,
          });
        }
        setLoaded(true);
      },
      (err) => {
        console.error("pickLists subscription failed:", err);
        setList(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, eventCode]);

  const serverPicked = list?.picked ?? [];
  const picked = optimistic && optimistic.base === list ? optimistic.picks : serverPicked;

  const edit = useCallback(
    async (op: PickOp) => {
      if (!teamId || !eventCode || !actor) return;
      setError(null);
      setOptimistic({ picks: applyPickOp(picked, op), base: list });
      try {
        await editPickList({ teamId, eventCode, uid: actor.uid, name: actor.name }, op);
      } catch (err) {
        console.error("pick list edit failed:", err);
        setOptimistic(null);
        setError("Couldn't save that change. You may be offline, or no longer allowed to edit.");
      }
    },
    [teamId, eventCode, actor, picked, list]
  );

  return { list, picked, loaded, edit, error, clearError: () => setError(null) };
}

// --- per-user column setting -------------------------------------------------------

export type EpaMode = "calculated" | "off";

const EPA_KEY_PREFIX = "compepicurus.pickList.epa.";
const listeners = new Set<() => void>();

function readEpa(uid: string): EpaMode {
  try {
    return window.localStorage.getItem(EPA_KEY_PREFIX + uid) === "off" ? "off" : "calculated";
  } catch {
    return "calculated"; // storage blocked (private window, etc.) — the default is fine
  }
}

/**
 * "EPA: Calculated / Off", remembered per user: stored in this browser's
 * localStorage under the signed-in user's id, so two people sharing a browser
 * keep separate settings, but it does not follow a person to another device
 * (see docs/ASSUMPTIONS.md, P12). Defaults to Calculated; SSR renders the
 * default so hydration matches.
 */
export function useEpaMode(uid: string | null): [EpaMode, (mode: EpaMode) => void] {
  const mode = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      window.addEventListener("storage", onChange);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    (): EpaMode => (uid ? readEpa(uid) : "calculated"),
    (): EpaMode => "calculated"
  );

  const setMode = useCallback(
    (next: EpaMode) => {
      if (!uid) return;
      try {
        window.localStorage.setItem(EPA_KEY_PREFIX + uid, next);
      } catch {
        // Couldn't persist; the in-memory notification below still updates this session.
      }
      listeners.forEach((l) => l());
    },
    [uid]
  );

  return [mode, setMode];
}

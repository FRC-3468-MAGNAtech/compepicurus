"use client";

import { addDoc, collection, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";

/**
 * P5: every admin-only scout-data action (Hard Reset, Dismiss Flag, Exclude/
 * Include) writes one of these — not read by any UI yet (that's P9's Admin
 * tools), but the write path and rules exist now so nothing needs touching
 * later just to start logging.
 */
export type AuditAction = "hard-reset-scout-data" | "dismiss-flag" | "exclude-session" | "include-session";

export type AuditLogEntry = {
  id: string;
  teamId: string;
  uid: string;
  actorName: string;
  action: AuditAction;
  /** Free-form, action-specific context — e.g. `{ targetUid, targetName, category }` for a hard reset. */
  target: Record<string, unknown>;
  before: unknown;
  after: unknown;
  createdAt: unknown;
};

const COLLECTION = "auditLog";

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0; // not yet server-resolved (pending write) — sorts last, fine for a log that's about to get a real timestamp any moment
}

export async function logAuditEvent(
  teamId: string,
  uid: string,
  actorName: string,
  action: AuditAction,
  target: Record<string, unknown>,
  before: unknown,
  after: unknown
): Promise<void> {
  await addDoc(collection(db, COLLECTION), {
    teamId,
    uid,
    actorName,
    action,
    target,
    before,
    after,
    createdAt: serverTimestamp(),
  });
}

/**
 * Realtime, most recent first — unused by any P5 page, kept here so P9's
 * Admin tools only need to render it. Sorts client-side (not `orderBy` in
 * the query) purely to avoid needing a composite index for a feature
 * nothing reads yet; P9 can add one once this has real query patterns.
 */
export function useAuditLog(teamId: string | null) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, COLLECTION), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditLogEntry);
        next.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setEntries(next);
        setLoaded(true);
      },
      (err) => {
        console.error("auditLog subscription failed:", err);
        setEntries([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { entries, loaded };
}

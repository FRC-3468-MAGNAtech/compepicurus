"use client";

import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";

/**
 * P5: every admin-only scout-data action (Hard Reset, Dismiss Flag, Exclude/
 * Include) writes one of these; P9 adds the Admin Panel's own session/entry
 * edit, rescore, and backup actions. `firestore.rules` never restricts this
 * field's value (only `uid`/`teamId` on create), so adding a new action here
 * needs no rules change — see docs/ASSUMPTIONS.md (P9).
 */
export type AuditAction =
  | "hard-reset-scout-data"
  | "dismiss-flag"
  | "exclude-session"
  | "include-session"
  | "edit-entry"
  | "rescore-event"
  | "rescore-sessions"
  | "refresh-official-scores"
  | "export-backup"
  | "edit-member-roles"
  | "edit-member-teams"
  | "edit-field-teams"
  | "approve-team-application"
  | "request-ownership-transfer"
  | "transfer-ownership"
  | "decline-ownership-transfer"
  | "cancel-ownership-transfer"
  | "force-transfer-ownership"
  | "edit-pick-list"
  | "create-changelog-entry"
  | "edit-changelog-entry"
  | "delete-changelog-entry"
  | "edit-credits"
  | "edit-match-library"
  // P22: the Form Builder
  | "create-form"
  | "publish-form"
  | "restore-form-version"
  | "discard-form-draft"
  | "archive-form"
  | "unarchive-form"
  | "reset-form-to-builtin"
  | "set-active-form"
  // P23: form templates
  | "save-form-template"
  | "update-form-template"
  | "delete-form-template"
  | "use-form-template"
  | "request-template-publish"
  | "unpublish-template"
  | "template-reviewed"
  // P25: an admin cleared a teammate's profile bio / pronouns (moderation; admins can clear, never write)
  | "clear-profile-text"
  // P26: page access (the role matrix, member overrides, and deciding an access request)
  | "edit-page-access"
  | "decide-page-access-request"
  // P29: a scout edited their own earlier form entry (the log keeps what it was and what it became)
  | "edit-form-entry";

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

/** The document written for one audit entry — shared by logAuditEvent() and by callers that must write the entry in the *same batch* as the change it records (see lib/team-members.ts). */
export function buildAuditEntry(
  teamId: string,
  uid: string,
  actorName: string,
  action: AuditAction,
  target: Record<string, unknown>,
  before: unknown,
  after: unknown
) {
  return { teamId, uid, actorName, action, target, before, after, createdAt: serverTimestamp() };
}

/** A new, empty `auditLog` doc ref — for batched writes that need the ref up front. */
export function newAuditLogRef() {
  return doc(collection(db, COLLECTION));
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
  await addDoc(collection(db, COLLECTION), buildAuditEntry(teamId, uid, actorName, action, target, before, after));
}

/**
 * Realtime, most recent first — read by the Admin Panel's Audit Log tab
 * (P9). Sorts client-side (not `orderBy` in the query) to avoid needing a
 * composite index for what's still a small, single-field-filtered log;
 * revisit if `auditLog` ever grows enough to need a real query pattern.
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

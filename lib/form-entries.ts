"use client";

import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch, type QueryConstraint } from "firebase/firestore";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import { formEntryDoc, toFormEntry, type FormEntry, type NewFormEntry } from "@/lib/form-entries-model";
import { diffEntryValues } from "@/lib/form-entries-model";
import type { FormValues, StickyNote } from "@/lib/forms/types";

// P27: reading and writing `formEntries/{entryId}` (see lib/form-entries-model.ts for the shape and firestore.rules for who may do what).

const COLLECTION = "formEntries";

/** Saves an entry as yourself. Resolves with its id (so a photo still uploading can be attached to it afterwards). */
export async function saveFormEntry(teamId: string, uid: string, input: NewFormEntry): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), formEntryDoc(teamId, uid, input));
  return ref.id;
}

/** The writer may change only values and notes; an admin may change more (the rules decide). */
export async function updateFormEntry(entryId: string, patch: { values?: FormValues; stickyNotes?: StickyNote[] }): Promise<void> {
  await updateDoc(doc(db, COLLECTION, entryId), { ...patch, updatedAt: serverTimestamp() });
}

/**
 * A scout edits their own earlier entry (P29): the new values and notes, and an `edit-form-entry` audit entry with what changed, in one batch. The rules let the
 * writer change only `values`, `stickyNotes` and `updatedAt`; the log keeps the history (admins read it in Admin Panel > Audit Log).
 */
export async function editOwnFormEntry(actor: { teamId: string; uid: string; name: string }, entry: Pick<FormEntry, "id" | "formId" | "eventCode" | "teamNumber" | "values" | "stickyNotes">, patch: { values: FormValues; stickyNotes: StickyNote[] }): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION, entry.id), { values: patch.values, stickyNotes: patch.stickyNotes, updatedAt: serverTimestamp() });
  batch.set(
    newAuditLogRef(),
    buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-form-entry", { entryId: entry.id, formId: entry.formId, eventCode: entry.eventCode, teamNumber: entry.teamNumber ?? null }, { values: entry.values, notes: entry.stickyNotes.length }, { values: patch.values, notes: patch.stickyNotes.length, changedKeys: diffEntryValues(entry.values, patch.values) })
  );
  await batch.commit();
}

/** Admins only (the rules decide): exclude an entry, set its flags, or fix its values (an import-time correction). */
export async function adminUpdateFormEntry(entryId: string, patch: { excluded?: boolean; flags?: FormEntry["flags"]; values?: FormValues }): Promise<void> {
  await updateDoc(doc(db, COLLECTION, entryId), { ...patch, updatedAt: serverTimestamp() });
}

/** Admins only. */
export async function deleteFormEntry(entryId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, entryId));
}

export type FormEntriesFilter = { formId?: string; eventCode?: string };

/** The team's entries, live, optionally of one form and/or one event, newest first. */
export function useFormEntries(teamId: string | null, filter: FormEntriesFilter = {}): { entries: FormEntry[]; loaded: boolean } {
  const [held, setHeld] = useState<{ key: string; entries: FormEntry[] } | null>(null);
  const key = teamId ? `${teamId}|${filter.formId ?? ""}|${filter.eventCode ?? ""}` : null;

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) return;
    const k = `${teamId}|${filter.formId ?? ""}|${filter.eventCode ?? ""}`;
    const constraints: QueryConstraint[] = [where("teamId", "==", teamId)];
    if (filter.formId) constraints.push(where("formId", "==", filter.formId));
    if (filter.eventCode) constraints.push(where("eventCode", "==", filter.eventCode));
    return onSnapshot(
      query(collection(db, COLLECTION), ...constraints),
      (snap) => setHeld({ key: k, entries: snap.docs.map((d) => toFormEntry(d.id, d.data())).sort((a, b) => b.createdAtMs - a.createdAtMs) }),
      (err) => {
        reportFirestoreError("form entries subscription failed", err, COLLECTION);
        setHeld({ key: k, entries: [] });
      }
    );
  }, [teamId, filter.formId, filter.eventCode]);

  if (!key) return { entries: [], loaded: true };
  return held?.key === key ? { entries: held.entries, loaded: true } : { entries: [], loaded: false };
}

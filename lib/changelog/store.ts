"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { entryFromData, hasUnread, normalizeDraft, sortEntries, timestampMs, entryToDraft, type ChangelogDraft, type ChangelogEntry } from "@/lib/changelog";
import { STARTER_ENTRIES, starterDocId } from "@/lib/changelog/seed";

// Persistence for the Changelog (P14): `changelog/{id}`. Members read published
// entries only; admins read and write everything (firestore.rules).

const COLLECTION = "changelog";

type Actor = { teamId: string; uid: string; name: string };

/**
 * Realtime entries, newest first (pinned on top). Firestore rules aren't
 * filters, so a non-admin's query has to ask for `status == "published"`
 * itself — an unfiltered list would be rejected outright, not silently trimmed.
 */
export function useChangelog(teamId: string | null, isAdmin: boolean) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const base = collection(db, COLLECTION);
    const q = isAdmin ? query(base, where("teamId", "==", teamId)) : query(base, where("teamId", "==", teamId), where("status", "==", "published"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setEntries(sortEntries(snap.docs.map((d) => entryFromData(d.id, d.data()))));
        setLoaded(true);
      },
      (err) => {
        console.error("changelog subscription failed:", err);
        setEntries([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, isAdmin]);

  return { entries, loaded };
}

/**
 * The unread dot: true when a published entry went live after the user last
 * opened the Changelog (`lastSeenChangelogAt` on their user doc). Listens to
 * published entries only, for every role, so it costs the same for everyone.
 */
export function useChangelogUnread(teamId: string | null, lastSeenChangelogAt: unknown): boolean {
  const [published, setPublished] = useState<Pick<ChangelogEntry, "status" | "publishedAtMs">[]>([]);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPublished([]);
      return;
    }
    const q = query(collection(db, COLLECTION), where("teamId", "==", teamId), where("status", "==", "published"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setPublished(snap.docs.map((d) => ({ status: "published" as const, publishedAtMs: timestampMs(d.data().publishedAt) }))),
      (err) => {
        console.error("changelog unread subscription failed:", err);
        setPublished([]);
      }
    );
    return unsubscribe;
  }, [teamId]);

  const seenMs = timestampMs(lastSeenChangelogAt);
  return useMemo(() => hasUnread(published, seenMs), [published, seenMs]);
}

/** Stamps "I've seen the changelog up to now" on the user's own doc — clears the dot. Best-effort: a failure just leaves the dot. */
export async function markChangelogSeen(uid: string): Promise<void> {
  try {
    await updateDoc(doc(db, "users", uid), { lastSeenChangelogAt: serverTimestamp() });
  } catch (err) {
    console.error("couldn't record the changelog visit:", err);
  }
}

/** What an entry looks like in the audit log: its content, not its timestamps. */
const auditView = (d: ChangelogDraft) => ({ version: d.version, title: d.title, date: d.date, summary: d.summary, changes: d.changes, status: d.status, pinned: d.pinned });

/**
 * Creates (`id` null) or updates an entry in a transaction, with its audit
 * entry in the same transaction. `publishedAt` is set when an entry first goes
 * live and kept through later edits, so tweaking a typo in an old entry doesn't
 * light the unread dot for everyone again; unpublishing clears it.
 */
export async function saveEntry(actor: Actor, id: string | null, input: ChangelogDraft): Promise<string> {
  const draft = normalizeDraft(input);
  const ref = id ? doc(db, COLLECTION, id) : doc(collection(db, COLLECTION));
  await runTransaction(db, async (tx) => {
    let before: ChangelogDraft | null = null;
    let wasPublished = false;
    let createdBy = actor.uid;
    let createdAt: unknown = serverTimestamp();
    let publishedAt: unknown = null;
    if (id) {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("That entry no longer exists.");
      const current = entryFromData(snap.id, snap.data());
      before = entryToDraft(current);
      wasPublished = current.status === "published";
      createdBy = snap.data().createdBy ?? actor.uid;
      createdAt = snap.data().createdAt ?? serverTimestamp();
      publishedAt = snap.data().publishedAt ?? null;
    }
    if (draft.status === "published") {
      if (!wasPublished || publishedAt === null) publishedAt = serverTimestamp();
    } else {
      publishedAt = null;
    }

    tx.set(ref, { teamId: actor.teamId, ...draft, createdBy, createdAt, updatedAt: serverTimestamp(), publishedAt });
    tx.set(
      newAuditLogRef(),
      buildAuditEntry(actor.teamId, actor.uid, actor.name, id ? "edit-changelog-entry" : "create-changelog-entry", { entryId: ref.id, version: draft.version, title: draft.title }, before ? auditView(before) : null, auditView(draft))
    );
  });
  return ref.id;
}

/** Flips pinned and/or status on the *latest stored* entry, so a quick toggle never reverts someone's concurrent edit of its text. */
export async function patchEntry(actor: Actor, id: string, patch: Partial<Pick<ChangelogDraft, "pinned" | "status">>): Promise<void> {
  const ref = doc(db, COLLECTION, id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("That entry no longer exists.");
    const current = entryFromData(snap.id, snap.data());
    const before = entryToDraft(current);
    const after: ChangelogDraft = { ...before, ...patch };
    if (after.pinned === before.pinned && after.status === before.status) return;

    let publishedAt: unknown = snap.data().publishedAt ?? null;
    if (after.status === "published") {
      if (current.status !== "published" || publishedAt === null) publishedAt = serverTimestamp();
    } else {
      publishedAt = null;
    }
    tx.update(ref, { pinned: after.pinned, status: after.status, publishedAt, updatedAt: serverTimestamp() });
    tx.set(newAuditLogRef(), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-changelog-entry", { entryId: id, version: before.version, title: before.title }, auditView(before), auditView(after)));
  });
}

export async function deleteEntry(actor: Actor, id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return; // already gone (another admin got there first)
    const before = entryToDraft(entryFromData(snap.id, snap.data()));
    tx.delete(ref);
    tx.set(newAuditLogRef(), buildAuditEntry(actor.teamId, actor.uid, actor.name, "delete-changelog-entry", { entryId: id, version: before.version, title: before.title }, auditView(before), null));
  });
}

/**
 * Creates the starter drafts the first time an admin opens the Changelog. The
 * team doc's `changelogSeeded` flag is read and set in the same transaction, so
 * two admins opening the page at once seed once, and the drafts don't come back
 * after an admin deletes them. Everything is created as a draft: nothing goes
 * live until an admin publishes it.
 */
export async function seedChangelogIfNeeded(actor: Actor): Promise<boolean> {
  const teamRef = doc(db, "teams", actor.teamId);
  return runTransaction(db, async (tx) => {
    const team = await tx.get(teamRef);
    if (!team.exists() || team.data().changelogSeeded === true) return false;

    for (const s of STARTER_ENTRIES) {
      tx.set(doc(db, COLLECTION, starterDocId(actor.teamId, s.key)), {
        teamId: actor.teamId,
        version: s.version,
        title: s.title,
        date: s.date,
        summary: s.summary,
        changes: s.changes,
        status: "draft",
        pinned: false,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        publishedAt: null,
      });
    }
    tx.update(teamRef, { changelogSeeded: true });
    tx.set(newAuditLogRef(), buildAuditEntry(actor.teamId, actor.uid, actor.name, "create-changelog-entry", { seeded: STARTER_ENTRIES.length }, null, { drafts: STARTER_ENTRIES.map((s) => s.version) }));
    return true;
  });
}

/** Runs a write and reports failure as a message instead of throwing — for buttons that show an inline error. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, failure: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      console.error(failure, err);
      setError(err instanceof Error && err.message.startsWith("That entry") ? err.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: () => setError(null) };
}

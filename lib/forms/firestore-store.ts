"use client";

import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, updateDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { Form } from "@/lib/forms/types";
import { formDocId, listFormSummaries, resolveForm, versionKey, type FormCatalog, type FormDoc, type FormSummary, type FormVersion } from "@/lib/forms/resolve";
import { archiveTransition, discardDraftTransition, plain, publishTransition, resetTransition, saveDraftTransition, FormStoreError, type Actor } from "@/lib/forms/transitions";
import type { FormStore } from "@/lib/forms/store";

// P21: the Firestore FormStore. Layout: `forms/{teamId}_{formId}` holds the working draft, the latest published version number and whether an
// override is active (FormDoc); `forms/{teamId}_{formId}/versions/{n}` holds each published version, write-once (rules refuse any update or
// delete). The id carries the team so two accounts' "biobuzz" overrides can't collide. Every write is one transaction around the pure
// transitions in lib/forms/transitions.ts, which also run in the in-memory store and the tests.

const FORMS = "forms";

const docRef = (teamId: string, formId: string) => doc(db, FORMS, formDocId(teamId, formId));
const versionRef = (teamId: string, formId: string, version: number) => doc(db, FORMS, formDocId(teamId, formId), "versions", String(version));

/** Realtime: every form doc of the account (drafts, latest published version numbers, archived/active flags). Versions are loaded on demand. */
export function subscribeFormDocs(teamId: string, onDocs: (docs: Map<string, FormDoc>) => void, onError?: (err: unknown) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, FORMS), where("teamId", "==", teamId)),
    (snap) => {
      const docs = new Map<string, FormDoc>();
      for (const d of snap.docs) {
        const data = d.data() as FormDoc;
        docs.set(data.formId, data);
      }
      onDocs(docs);
    },
    onError
  );
}

/** One published version, or null. */
export async function loadFormVersion(teamId: string, formId: string, version: number): Promise<Form | null> {
  const snap = await getDoc(versionRef(teamId, formId, version));
  return snap.exists() ? ((snap.data() as FormVersion).form ?? null) : null;
}

/** Every published version of a form (newest first), for the builder's version history. A built-in's own version 1 isn't stored: it lives in code. */
export async function loadAllVersions(teamId: string, formId: string): Promise<FormVersion[]> {
  const snap = await getDocs(collection(db, FORMS, formDocId(teamId, formId), "versions"));
  return snap.docs.map((d) => d.data() as FormVersion).sort((a, b) => b.version - a.version);
}

/** The account's current form for an id, by reading just the docs it needs. */
async function loadCatalogFor(teamId: string, formId: string, version?: number): Promise<FormCatalog> {
  const snap = await getDoc(docRef(teamId, formId));
  const docs = new Map<string, FormDoc>();
  const versions = new Map<string, Form>();
  if (snap.exists()) {
    const data = snap.data() as FormDoc;
    docs.set(formId, data);
    const wanted = version ?? (data.active ? data.publishedVersion : null);
    if (wanted !== null && wanted !== undefined) {
      const form = await loadFormVersion(teamId, formId, wanted);
      if (form) versions.set(versionKey(formId, wanted), form);
    }
  } else if (version !== undefined) {
    const form = await loadFormVersion(teamId, formId, version);
    if (form) versions.set(versionKey(formId, version), form);
  }
  return { docs, versions };
}

export function createFirestoreFormStore(teamId: string, actor: Actor): FormStore {
  const now = () => Date.now();
  return {
    async listForms(): Promise<FormSummary[]> {
      const snap = await getDocs(query(collection(db, FORMS), where("teamId", "==", teamId)));
      const docs = new Map<string, FormDoc>();
      for (const d of snap.docs) docs.set((d.data() as FormDoc).formId, d.data() as FormDoc);
      return listFormSummaries({ docs, versions: new Map() });
    },
    async getForm(formId, version) {
      return resolveForm(await loadCatalogFor(teamId, formId, version), formId, version);
    },
    async getDraft(formId) {
      const snap = await getDoc(docRef(teamId, formId));
      return snap.exists() ? ((snap.data() as FormDoc).draft ?? null) : null;
    },
    async listVersions(formId) {
      return loadAllVersions(teamId, formId);
    },
    async saveDraft(form) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, form.id);
        const snap = await txn.get(ref);
        txn.set(ref, saveDraftTransition(snap.exists() ? (snap.data() as FormDoc) : null, teamId, form, actor, now()));
      });
    },
    async discardDraft(formId) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId);
        const snap = await txn.get(ref);
        txn.set(ref, discardDraftTransition(snap.exists() ? (snap.data() as FormDoc) : null, actor, now()));
      });
    },
    async publish(formId, note) {
      return runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId);
        const snap = await txn.get(ref);
        const result = publishTransition(snap.exists() ? (snap.data() as FormDoc) : null, actor, now(), note);
        // Write-once: the rules only allow creating this version doc together with the doc's own version bump.
        txn.set(versionRef(teamId, formId, result.version.version), plain(result.version));
        txn.set(ref, result.doc);
        return { version: result.version.version };
      });
    },
    async archive(formId, archived) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId);
        const snap = await txn.get(ref);
        txn.set(ref, archiveTransition(snap.exists() ? (snap.data() as FormDoc) : null, archived, actor, now()));
      });
    },
    async resetToBuiltin(formId) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId);
        const snap = await txn.get(ref);
        txn.set(ref, resetTransition(snap.exists() ? (snap.data() as FormDoc) : null, actor, now()));
      });
    },
  };
}

/** Maps a season to the form scouts use for it (`teams.activeForms.{seasonId}`). Admin-only in the rules. The form must be publishable-as-active (see `canBeActive`). */
export async function setActiveForm(teamId: string, seasonId: string, formId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(seasonId) || !/^[A-Za-z0-9_-]{1,40}$/.test(formId)) throw new FormStoreError("invalid", "That isn't a valid season or form.");
  await updateDoc(doc(db, "teams", teamId), { [`activeForms.${seasonId}`]: formId });
}

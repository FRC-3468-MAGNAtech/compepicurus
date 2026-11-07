import type { Form } from "@/lib/forms/types";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { listFormSummaries, resolveForm, type FormCatalog, type FormDoc, type FormSummary, type FormVersion } from "@/lib/forms/resolve";
import { FormStoreError, archiveTransition, discardDraftTransition, publishTransition, resetTransition, saveDraftTransition, type Actor } from "@/lib/forms/transitions";

// P21: the FormStore: `getForm`, `listForms`, `saveDraft`, `publish` (plus `getDraft`, `archive`, `resetToBuiltin` for the builder).
// This file is the interface and the in-memory implementation (used by tests and as the reference semantics). The Firestore
// implementation is lib/forms/firestore-store.ts; both go through lib/forms/transitions.ts, so they cannot disagree.

export interface FormStore {
  /** Every form the account can use: the built-ins (with their override's state) and its custom forms. */
  listForms(): Promise<FormSummary[]>;
  /** A form at a version (or the latest published, when omitted). Never returns an unpublished draft. */
  getForm(formId: string, version?: number): Promise<Form | null>;
  /** The working copy (unpublished changes), or null. */
  getDraft(formId: string): Promise<Form | null>;
  /** Every published version stored for the form, newest first (a built-in's own version 1 lives in code, not here). */
  listVersions(formId: string): Promise<FormVersion[]>;
  saveDraft(form: Form): Promise<void>;
  /** Throws away the working copy (back to the last published version or the built-in). */
  discardDraft(formId: string): Promise<void>;
  /** Publishes the draft as the next immutable version. Throws FormStoreError when there's no draft or it has blocking errors. */
  publish(formId: string, note?: string): Promise<{ version: number }>;
  archive(formId: string, archived: boolean): Promise<void>;
  /** Stops an edited built-in's override applying. */
  resetToBuiltin(formId: string): Promise<void>;
}

/** An in-memory FormStore: the reference implementation of the semantics. `now` is injectable so tests control time. */
export function createMemoryFormStore(options: { teamId?: string; actor?: Actor; now?: () => number } = {}): FormStore & { catalog: () => FormCatalog; versionDocs: () => FormVersion[] } {
  const teamId = options.teamId ?? "team-1";
  const actor = options.actor ?? { uid: "user-1" };
  const now = options.now ?? (() => Date.now());
  const docs = new Map<string, FormDoc>();
  const versions = new Map<string, FormVersion>();
  const keyOf = (formId: string, n: number) => `${formId}@${n}`;

  const catalog = (): FormCatalog => ({ docs, versions: new Map([...versions].map(([k, v]) => [k, v.form])) });

  return {
    catalog,
    versionDocs: () => [...versions.values()],
    async listForms() {
      return listFormSummaries(catalog());
    },
    async getForm(formId, version) {
      return resolveForm(catalog(), formId, version);
    },
    async getDraft(formId) {
      return docs.get(formId)?.draft ?? null;
    },
    async listVersions(formId) {
      return [...versions.values()].filter((v) => v.formId === formId).sort((a, b) => b.version - a.version);
    },
    async saveDraft(form) {
      docs.set(form.id, saveDraftTransition(docs.get(form.id) ?? null, teamId, form, actor, now()));
    },
    async discardDraft(formId) {
      docs.set(formId, discardDraftTransition(docs.get(formId) ?? null, actor, now()));
    },
    async publish(formId, note) {
      const result = publishTransition(docs.get(formId) ?? null, actor, now(), note);
      // Published versions are write-once: refuse to overwrite one.
      if (versions.has(keyOf(formId, result.version.version))) throw new FormStoreError("invalid", "That version already exists.");
      versions.set(keyOf(formId, result.version.version), result.version);
      docs.set(formId, result.doc);
      return { version: result.version.version };
    },
    async archive(formId, archived) {
      docs.set(formId, archiveTransition(docs.get(formId) ?? null, archived, actor, now()));
    },
    async resetToBuiltin(formId) {
      if (!BUILTIN_FORMS[formId]) throw new FormStoreError("unknown-built-in", "Only a built-in form can be reset.");
      docs.set(formId, resetTransition(docs.get(formId) ?? null, actor, now()));
    },
  };
}

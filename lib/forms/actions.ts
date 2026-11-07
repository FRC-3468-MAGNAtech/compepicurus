"use client";

import { logAuditEvent } from "@/lib/audit-log";
import { setActiveForm } from "@/lib/forms/firestore-store";
import type { FormDiff } from "@/lib/forms/diff";
import type { FormStore } from "@/lib/forms/store";
import type { Form } from "@/lib/forms/types";

// P22: the Form Builder's writes, each followed by an `auditLog` entry (publish, restore, archive, reset, set active, create, discard).
// The store does the write in a transaction; the audit entry is written right after (the same order the other admin tools use). Every
// function here is one user action, so the UI has one place to call and the audit trail can't be forgotten.

/** Who is acting, for the audit log. `audit` and `setActive` are injectable so the Playwright fixture page can run the builder without Firestore. */
export type FormActor = { teamId: string; uid: string; name: string; audit?: typeof logAuditEvent; setActive?: typeof setActiveForm };

const audit = (a: FormActor, action: Parameters<typeof logAuditEvent>[3], target: Record<string, unknown>, before: unknown, after: unknown) =>
  (a.audit ?? logAuditEvent)(a.teamId, a.uid, a.name, action, target, before, after);

/** Saves a brand-new form (from scratch, a duplicate, an import or a template) as an unpublished draft. */
export async function createFormAction(a: FormActor, store: FormStore, form: Form, how: "scratch" | "duplicate" | "import" | "template" | "built-in-edit", extra: Record<string, unknown> = {}): Promise<void> {
  await store.saveDraft(form);
  await audit(a, "create-form", { formId: form.id, name: form.name, how, ...extra }, null, { fields: form.sections.reduce((n, s) => n + s.fields.length, 0) });
}

export type PublishContext = { previousVersion: number | null; diff: FormDiff | null; affectedEntries: number; /** The form's name at publish time (it may have been renamed in the builder). */ formName?: string };

/** Publishes the draft as the next immutable version. Returns the version number. */
export async function publishFormAction(a: FormActor, store: FormStore, formId: string, name: string, note: string | undefined, ctx: PublishContext): Promise<number> {
  const { version } = await store.publish(formId, note);
  await audit(
    a,
    "publish-form",
    { formId, name: ctx.formName ?? name, ...(note?.trim() ? { note: note.trim() } : {}) },
    { version: ctx.previousVersion },
    {
      version,
      affectsScores: ctx.diff?.impact.scores ?? false,
      affectsData: ctx.diff?.impact.data ?? false,
      fieldsAdded: ctx.diff?.counts.added ?? 0,
      changes: ctx.diff?.counts.changed ?? 0,
      affectedEntries: ctx.affectedEntries,
    }
  );
  return version;
}

/** "Restore" puts an old version's content into the draft (the builder saves it; nothing changes for scouts until it is published as a new version). This records it. */
export async function restoreVersionAction(a: FormActor, formId: string, name: string, restoredVersion: number): Promise<void> {
  await audit(a, "restore-form-version", { formId, name, restoredVersion }, null, { intoDraft: true });
}

export async function discardDraftAction(a: FormActor, store: FormStore, formId: string, name: string): Promise<void> {
  await store.discardDraft(formId);
  await audit(a, "discard-form-draft", { formId, name }, null, null);
}

export async function archiveFormAction(a: FormActor, store: FormStore, formId: string, name: string, archived: boolean, entries: number): Promise<void> {
  await store.archive(formId, archived);
  await audit(a, archived ? "archive-form" : "unarchive-form", { formId, name, entries }, { archived: !archived }, { archived });
}

export async function resetFormAction(a: FormActor, store: FormStore, formId: string, name: string, fromVersion: number | null): Promise<void> {
  await store.resetToBuiltin(formId);
  await audit(a, "reset-form-to-builtin", { formId, name }, { overrideVersion: fromVersion }, { overrideVersion: null });
}

export async function setActiveFormAction(a: FormActor, seasonId: string, formId: string, name: string, previousFormId: string): Promise<void> {
  await (a.setActive ?? setActiveForm)(a.teamId, seasonId, formId);
  await audit(a, "set-active-form", { seasonId, formId, name }, { formId: previousFormId }, { formId });
}

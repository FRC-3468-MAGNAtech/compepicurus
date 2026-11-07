import type { Form } from "@/lib/forms/types";
import { BUILTIN_FORMS, builtinHash } from "@/lib/forms/builtin";
import { checkForm, parseForm, blockingIssues, type FormIssue } from "@/lib/forms/validate";
import { nextVersion, type FormDoc, type FormVersion } from "@/lib/forms/resolve";

// P21: the pure state transitions of an account form (save a draft, publish a version, reset an override, archive). The Firestore
// store applies them inside a transaction, the in-memory store applies them directly, and both are tested through here, so a
// rule (published versions are immutable; an override is copy-on-write; publishing validates) exists exactly once.

export class FormStoreError extends Error {
  code: "invalid" | "not-found" | "no-draft" | "not-publishable" | "unknown-built-in";
  issues: FormIssue[];
  constructor(code: FormStoreError["code"], message: string, issues: FormIssue[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

/** Firestore refuses `undefined`; forms are JSON-safe, so a JSON round trip drops the optional fields that were left unset. */
export const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export type Actor = { uid: string };

/**
 * Saves the working copy. Creates the account's form doc on first save: for a built-in id that is a **copy-on-write override** (the
 * built-in's content hash is recorded so a later change to the code-defined original can be noticed); anything else is a custom form.
 * The stored draft is validated structurally (never trusted) but may still have semantic errors (it's a draft). Editing a built-in
 * does not change what scouts see until it is published.
 */
export function saveDraftTransition(existing: FormDoc | null, teamId: string, form: Form, actor: Actor, now: number): FormDoc {
  const parsed = parseForm(form);
  if (!parsed.ok) throw new FormStoreError("invalid", `That form isn't valid: ${parsed.issues[0]?.message ?? "unknown problem"}.`);
  const builtin = BUILTIN_FORMS[form.id] ?? null;
  const isOverride = builtin !== null;
  const base: FormDoc =
    existing ?? {
      teamId,
      formId: form.id,
      name: form.name,
      origin: isOverride ? "built-in-override" : form.origin === "template" ? "template" : "custom",
      ...(isOverride ? { baseBuiltInId: builtin.id, baseBuiltInHash: builtinHash(builtin.id) ?? undefined } : {}),
      publishedVersion: null,
      draft: null,
      // an override only counts once published; a custom form has no meaning before its first publish either
      active: false,
      archived: false,
      createdBy: actor.uid,
      createdAt: now,
    };
  const version = nextVersion(base, isOverride ? builtin.id : null);
  const draft: Form = {
    ...parsed.form,
    version,
    status: "draft",
    origin: base.origin,
    ...(base.baseBuiltInId ? { baseBuiltInId: base.baseBuiltInId, baseBuiltInHash: base.baseBuiltInHash } : {}),
    updatedAt: now,
  };
  return plain({ ...base, name: draft.name, draft, updatedAt: now, updatedBy: actor.uid });
}

export type PublishResult = { doc: FormDoc; version: FormVersion };

/**
 * Publishes the draft as the next immutable version. Refuses when there is no draft or it has blocking errors. The version number is one
 * past the latest published (and for a built-in's first override, one past the built-in's own, so the built-in's entries keep resolving
 * to the original).
 */
export function publishTransition(doc: FormDoc | null, actor: Actor, now: number, note?: string): PublishResult {
  if (!doc) throw new FormStoreError("not-found", "That form doesn't exist.");
  if (!doc.draft) throw new FormStoreError("no-draft", "There are no changes to publish.");
  const issues = checkForm(doc.draft);
  const errors = blockingIssues(issues);
  if (errors.length > 0) throw new FormStoreError("not-publishable", `Fix ${errors.length} problem${errors.length === 1 ? "" : "s"} before publishing: ${errors[0].message}`, issues);

  const version = nextVersion(doc, doc.baseBuiltInId);
  const form: Form = { ...doc.draft, version, status: "published", updatedAt: now };
  const versionDoc: FormVersion = {
    teamId: doc.teamId,
    formId: doc.formId,
    version,
    form: plain(form),
    ...(note?.trim() ? { note: note.trim().slice(0, 300) } : {}),
    createdBy: actor.uid,
    createdAt: now,
  };
  return { doc: plain({ ...doc, publishedVersion: version, draft: null, active: true, name: form.name, updatedAt: now, updatedBy: actor.uid }), version: versionDoc };
}

/** "Reset to built-in": the override stops applying (scouts get the code-defined form again). Its published versions stay, so entries scouted with them keep their form. */
export function resetTransition(doc: FormDoc | null, actor: Actor, now: number): FormDoc {
  if (!doc || !doc.baseBuiltInId) throw new FormStoreError("unknown-built-in", "Only an edited built-in form can be reset.");
  return plain({ ...doc, active: false, draft: null, updatedAt: now, updatedBy: actor.uid });
}

/**
 * Throws away the working copy (P22: "Discard changes"). Only for a form that has something to fall back to: a published version, or a
 * built-in (an override that was never published just goes back to the built-in). A custom form that was never published has no
 * published version to fall back to, so it can only be archived.
 */
export function discardDraftTransition(doc: FormDoc | null, actor: Actor, now: number): FormDoc {
  if (!doc) throw new FormStoreError("not-found", "That form doesn't exist.");
  if (!doc.draft) throw new FormStoreError("no-draft", "There are no unpublished changes to discard.");
  if (doc.publishedVersion === null && !doc.baseBuiltInId) throw new FormStoreError("invalid", "This form has never been published, so there is nothing to go back to. Archive it instead.");
  return plain({ ...doc, draft: null, updatedAt: now, updatedBy: actor.uid });
}

export function archiveTransition(doc: FormDoc | null, archived: boolean, actor: Actor, now: number): FormDoc {
  if (!doc) throw new FormStoreError("not-found", "That form doesn't exist.");
  return plain({ ...doc, archived, updatedAt: now, updatedBy: actor.uid });
}

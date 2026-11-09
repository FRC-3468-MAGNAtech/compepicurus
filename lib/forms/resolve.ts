import type { Form, FormOrigin } from "@/lib/forms/types";
import { BUILTIN_FORMS, builtinHash } from "@/lib/forms/builtin";

// P21: how a (formId, version) becomes a Form: the built-in forms in code, an account's copy-on-write override of one,
// or an account's custom form. Pure (no Firebase), so the Firestore store, the in-memory store and the tests share it.
//
// Storage (forms/{docId}, docId = `${teamId}_${formId}` so ids can't collide between accounts; versions in forms/{docId}/versions/{n}):
//   FormDoc      the current state of one account form: its unpublished draft, the latest published version, whether an override is in effect
//   FormVersion  one published version: immutable, write-once

export type FormDoc = {
  teamId: string;
  formId: string;
  name: string;
  origin: FormOrigin;
  baseBuiltInId?: string;
  baseBuiltInHash?: string;
  /** The latest published version number, or null if none has been published yet. */
  publishedVersion: number | null;
  /** The working copy: unpublished changes, or null when there are none. */
  draft: Form | null;
  /** A built-in override only counts while `active`; "reset to built-in" turns it off (its versions stay, so old entries keep resolving). Custom forms are always active. */
  active: boolean;
  archived: boolean;
  createdBy: string;
  createdAt?: number;
  updatedAt?: number;
  updatedBy?: string;
};

export type FormVersion = { teamId: string; formId: string; version: number; form: Form; note?: string; createdBy: string; createdAt?: number };

/** Everything an account's forms are made of, loaded: the docs, and whichever published versions have been read so far. */
export type FormCatalog = {
  docs: ReadonlyMap<string, FormDoc>;
  versions: ReadonlyMap<string, Form>;
};

export const versionKey = (formId: string, version: number): string => `${formId}@${version}`;
export const formDocId = (teamId: string, formId: string): string => `${teamId}_${formId}`;

export const emptyCatalog = (): FormCatalog => ({ docs: new Map(), versions: new Map() });

/**
 * The form for `formId` at `version` (or the latest when omitted), or `null` when it doesn't exist (or isn't loaded: the catalog
 * only holds versions that were read). A built-in's own version always resolves to the code-defined original, so entries scouted before an
 * override existed read with the form they were scouted with.
 */
export function resolveForm(catalog: FormCatalog, formId: string, version?: number): Form | null {
  const builtin = BUILTIN_FORMS[formId] ?? null;
  const doc = catalog.docs.get(formId) ?? null;

  if (version !== undefined) {
    const stored = catalog.versions.get(versionKey(formId, version));
    if (stored) return stored;
    if (builtin && version === builtin.version) return builtin;
    return null;
  }
  if (doc && doc.active && doc.publishedVersion !== null) {
    return catalog.versions.get(versionKey(formId, doc.publishedVersion)) ?? null;
  }
  return builtin; // no override in effect (or no such custom form: null)
}

/**
 * Like `resolveForm`, but never fails for a form that exists in code: an entry whose exact version can't be found falls back to
 * the built-in (so a BIOBUZZ entry always renders), and only an unknown custom form returns `null`.
 */
export function resolveFormForEntry(catalog: FormCatalog, formId: string, version?: number): Form | null {
  return resolveForm(catalog, formId, version) ?? resolveForm(catalog, formId) ?? BUILTIN_FORMS[formId] ?? null;
}

/** The version number the next publish will take: one past the latest published, and for a first override of a built-in, one past the built-in's own. */
export function nextVersion(doc: Pick<FormDoc, "publishedVersion" | "baseBuiltInId"> | null, builtinId?: string | null): number {
  if (doc?.publishedVersion != null) return doc.publishedVersion + 1;
  const builtin = builtinId ? BUILTIN_FORMS[builtinId] : doc?.baseBuiltInId ? BUILTIN_FORMS[doc.baseBuiltInId] : undefined;
  return (builtin?.version ?? 0) + 1;
}

/** Has the code-defined built-in changed since this override was made? (Its stored hash no longer matches the original's current one.) */
export function builtinChangedSince(doc: Pick<FormDoc, "baseBuiltInId" | "baseBuiltInHash">): boolean {
  if (!doc.baseBuiltInId || !doc.baseBuiltInHash) return false;
  const current = builtinHash(doc.baseBuiltInId);
  return current !== null && current !== doc.baseBuiltInHash;
}

export type FormSummary = {
  id: string;
  name: string;
  origin: FormOrigin;
  /** `published` once any version is published (or for an untouched built-in); `draft` for a form never published. */
  status: "draft" | "published";
  /** The latest published version (a built-in's own while it has no override). */
  version: number | null;
  /** Unpublished changes exist. */
  hasDraft: boolean;
  /** A built-in with an active override. */
  overridden: boolean;
  /** An override whose code-defined original has changed since it was made. */
  builtinChanged: boolean;
  archived: boolean;
  updatedAt?: number;
};

/** Every form the account can use: the code-defined built-ins (with their override's state when one exists) and the account's custom forms. */
export function listFormSummaries(catalog: FormCatalog): FormSummary[] {
  const out: FormSummary[] = [];
  for (const builtin of Object.values(BUILTIN_FORMS)) {
    const doc = catalog.docs.get(builtin.id);
    const overridden = !!doc && doc.active && doc.publishedVersion !== null;
    out.push({
      id: builtin.id,
      name: doc?.name ?? builtin.name,
      origin: overridden || doc?.draft ? "built-in-override" : "built-in",
      status: "published",
      version: overridden ? doc!.publishedVersion : builtin.version,
      hasDraft: !!doc?.draft,
      overridden,
      builtinChanged: doc ? builtinChangedSince(doc) : false,
      archived: doc?.archived ?? false,
      updatedAt: doc?.updatedAt,
    });
  }
  for (const doc of catalog.docs.values()) {
    if (BUILTIN_FORMS[doc.formId]) continue;
    out.push({
      id: doc.formId,
      name: doc.name,
      origin: doc.origin,
      status: doc.publishedVersion !== null ? "published" : "draft",
      version: doc.publishedVersion,
      hasDraft: !!doc.draft,
      overridden: false,
      builtinChanged: false,
      archived: doc.archived,
      updatedAt: doc.updatedAt,
    });
  }
  return out;
}

/** The form id that is active for a season: the account's choice (`teams.activeForms`), else the season's own default (the built-in). */
export function activeFormIdFor(season: { id: string; formId: string }, activeForms: Readonly<Record<string, string>> | null | undefined): string {
  return activeForms?.[season.id] ?? season.formId;
}

/** Can a form be the active form for a season? It must have a published version (or be a built-in with none overridden) and not be archived. */
export function canBeActive(catalog: FormCatalog, formId: string): boolean {
  const doc = catalog.docs.get(formId);
  if (doc?.archived) return false;
  // P28: only a match-scout form can be a season's active form (the team's other forms have their own pages)
  const resolved = resolveForm(catalog, formId);
  if (resolved && resolved.formType !== "match-scout") return false;
  if (BUILTIN_FORMS[formId]) return true;
  return !!doc && doc.publishedVersion !== null;
}

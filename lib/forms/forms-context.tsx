"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { isFirebaseConfigured } from "@/lib/firebase/client";
import { useTeamDoc } from "@/lib/team";
import { getSeason } from "@/lib/seasons";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { unionForms } from "@/lib/analytics/game-schema";
import type { Form } from "@/lib/forms/types";
import { activeFormIdFor, canBeActive, emptyCatalog, listFormSummaries, resolveForm, resolveFormForEntry, versionKey, type FormCatalog, type FormDoc, type FormSummary } from "@/lib/forms/resolve";
import type { FormResolver } from "@/lib/forms/resolver";
import { loadFormVersion, subscribeFormDocs } from "@/lib/forms/firestore-store";

// P21: the account's forms for every screen, with synchronous lookups. The form docs are one realtime subscription; published versions are loaded
// on demand (and the latest of every active form eagerly) and cached. Outside the provider (isolated component tests, the Playwright fixture)
// the hooks fall back to the code-defined built-in forms and nothing else.

export type FormsValue = {
  /** False until the account's form docs have loaded, so a page never flashes the built-in before an override applies. */
  loaded: boolean;
  catalog: FormCatalog;
  summaries: FormSummary[];
  /** The account's current form for an id: its latest published version, else the built-in. Null for an unknown custom form. */
  latest: (formId: string) => Form | null;
  /** The form an entry was scouted with (its exact version, once loaded), falling back to the current one, then the built-in. */
  forEntry: (entry: { formId: string; formVersion?: number }) => Form | null;
  /** The resolver rescoring and recompute use: the **current** form per entry's `formId`. */
  currentResolver: FormResolver;
  /** Versions that were asked for but don't exist (so nothing should keep waiting for them): `formId@version`. */
  missing: ReadonlySet<string>;
  /** Asks for these exact versions to be loaded (idempotent); `forEntry` returns them once they arrive. */
  require: (pairs: { formId: string; version: number }[]) => void;
  /** `teams.activeForms`: which form each season uses. */
  activeForms: Readonly<Record<string, string>>;
  /** The form scouts fill in for a season (default: the active season). */
  activeFormFor: (seasonId?: string) => Form;
  /** The form id that is active for a season. */
  activeFormIdFor: (seasonId?: string) => string;
};

/** Builds the context value from a catalog. Exported for the Playwright fixture page, which feeds it an in-memory store's catalog. */
export function buildFormsValue(catalog: FormCatalog, loaded: boolean, activeForms: Readonly<Record<string, string>>, requireFn: FormsValue["require"], missing: ReadonlySet<string> = new Set()): FormsValue {
  const latest = (formId: string) => resolveForm(catalog, formId);
  const forEntry: FormsValue["forEntry"] = (entry) => resolveFormForEntry(catalog, entry.formId, entry.formVersion);
  const idFor = (seasonId?: string) => activeFormIdFor(getSeason(seasonId), activeForms);
  return {
    loaded,
    catalog,
    summaries: listFormSummaries(catalog),
    latest,
    forEntry,
    currentResolver: (entry) => latest(entry.formId),
    missing,
    require: requireFn,
    activeForms,
    activeFormIdFor: idFor,
    // An active form that can't be resolved (archived, unpublished) falls back to the season's built-in default: scouting never breaks.
    activeFormFor: (seasonId) => {
      const id = idFor(seasonId);
      return (canBeActive(catalog, id) ? latest(id) : null) ?? latest(getSeason(seasonId).formId) ?? BIOBUZZ_FORM;
    },
  };
}

const FALLBACK: FormsValue = buildFormsValue(emptyCatalog(), true, {}, () => {});

export const FormsContext = createContext<FormsValue | null>(null);

export function FormsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team } = useTeamDoc(teamId);
  const [docs, setDocs] = useState<ReadonlyMap<string, FormDoc>>(new Map());
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  const [versions, setVersions] = useState<ReadonlyMap<string, Form>>(new Map());
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [requested] = useState(() => new Set<string>());

  // The account's form docs, realtime.
  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDocs(new Map());
      setLoaded(true);
      return;
    }
    return subscribeFormDocs(
      teamId,
      (next) => {
        setDocs(next);
        setLoaded(true);
      },
      (err) => {
        console.error("forms subscription failed:", err);
        setDocs(new Map());
        setLoaded(true);
      }
    );
  }, [teamId]);

  const load = useCallback(
    (pairs: { formId: string; version: number }[]) => {
      if (!teamId || !isFirebaseConfigured()) return;
      for (const { formId, version } of pairs) {
        const key = versionKey(formId, version);
        if (requested.has(key)) continue;
        requested.add(key);
        loadFormVersion(teamId, formId, version)
          .then((form) => {
            if (form) setVersions((prev) => new Map(prev).set(key, form));
            else setMissing((prev) => new Set(prev).add(key)); // it doesn't exist: stop waiting for it (readers fall back to the current form)
          })
          .catch(() => requested.delete(key));
      }
    },
    [teamId, requested]
  );

  // Always have the latest version of every active form available.
  useEffect(() => {
    load([...docs.values()].filter((d) => d.active && d.publishedVersion !== null).map((d) => ({ formId: d.formId, version: d.publishedVersion as number })));
  }, [docs, load]);

  const activeForms = useMemo(() => (team?.activeForms as Record<string, string> | undefined) ?? {}, [team?.activeForms]);

  const value = useMemo(() => buildFormsValue({ docs, versions }, loaded, activeForms, load, missing), [docs, versions, loaded, activeForms, load, missing]);
  return <FormsContext.Provider value={value}>{children}</FormsContext.Provider>;
}

export function useForms(): FormsValue {
  return useContext(FormsContext) ?? FALLBACK;
}

/** The form scouts fill in for a season right now, and whether the account's forms have loaded. */
export function useActiveForm(seasonId?: string): { form: Form; loaded: boolean } {
  const forms = useForms();
  return { form: forms.activeFormFor(seasonId), loaded: forms.loaded };
}

/**
 * The form a practice/live session uses, **fixed for the session**: the season's active form as soon as the account's forms have loaded, and never
 * changed afterwards, so both robots of an alliance are scouted with the same form and version even if an admin publishes a new one mid-session.
 */
export function useLockedForm(seasonId?: string): Form {
  const { form, loaded } = useActiveForm(seasonId);
  const [locked, setLocked] = useState<Form | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loaded && !locked) setLocked(form);
  }, [loaded, form, locked]);
  return locked ?? form;
}

/**
 * Every form id whose entries count as a Game (season): the season's own built-in form, the form currently active for it, and any account form tagged with the
 * season. Analytics scopes by this set instead of by the season id alone, so entries scouted with an edited or custom form still show up.
 */
export function useGameFormIds(gameId: string): ReadonlySet<string> {
  const f = useForms();
  return useMemo(() => {
    const ids = new Set<string>([getSeason(gameId).formId, f.activeFormIdFor(gameId)]);
    for (const id of f.catalog.docs.keys()) if (f.latest(id)?.tags.includes(gameId)) ids.add(id);
    return ids;
  }, [f, gameId]);
}

/**
 * The one form an analytics table/stat set is built from: every version of every form the given entries were scouted with, unioned (so old and new
 * versions show together), or the season's active form when there are no entries. (A season's entries can come from several forms: the built-in, an edited
 * override, a custom form an admin switched to.)
 */
export function useSchemaForEntries(entries: readonly { formId: string; formVersion?: number }[], seasonId?: string): { schema: Form; ready: boolean } {
  const f = useForms();
  const { forms, ready } = useFormsForEntries(entries);
  const schema = useMemo(() => (forms.length > 0 ? unionForms(forms) : f.activeFormFor(seasonId)), [forms, f, seasonId]);
  return { schema, ready };
}

/**
 * The forms a set of entries were scouted with, loaded: it asks for every distinct (formId, formVersion) it hasn't got and returns, per formId, the
 * forms to build a table from. `ready` is true once every version needed is available (an entry whose version can't be found falls back to the current form).
 */
export function useFormsForEntries(entries: readonly { formId: string; formVersion?: number }[]): { forms: Form[]; ready: boolean } {
  const f = useForms();
  const needed = useMemo(() => {
    const seen = new Map<string, { formId: string; version: number }>();
    for (const e of entries) if (e.formVersion !== undefined) seen.set(versionKey(e.formId, e.formVersion), { formId: e.formId, version: e.formVersion });
    return [...seen.values()];
  }, [entries]);
  const { require: ask } = f;
  useEffect(() => {
    ask(needed);
  }, [needed, ask]);
  return useMemo(() => {
    const forms = new Map<string, Form>();
    let ready = f.loaded;
    for (const n of needed) {
      const exact = resolveForm(f.catalog, n.formId, n.version);
      if (exact) forms.set(versionKey(n.formId, n.version), exact);
      else if (f.catalog.docs.has(n.formId) && !f.missing.has(versionKey(n.formId, n.version))) ready = false; // still loading
    }
    for (const n of needed) {
      const fallback = f.latest(n.formId);
      if (!forms.has(versionKey(n.formId, n.version)) && fallback) forms.set(versionKey(n.formId, n.version), fallback);
    }
    return { forms: [...forms.values()], ready };
  }, [f, needed]);
}

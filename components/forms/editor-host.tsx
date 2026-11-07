"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormBuilder, type BuilderProps } from "@/components/forms/builder/builder";
import { discardDraftAction, publishFormAction, restoreVersionAction, type FormActor } from "@/lib/forms/actions";
import { getBuiltinForm } from "@/lib/forms/builtin";
import { builtinChangedSince, nextVersion, type FormCatalog } from "@/lib/forms/resolve";
import type { FormStore } from "@/lib/forms/store";
import type { FormUsage } from "@/lib/forms/usage";
import type { Form } from "@/lib/forms/types";

// P22: loads what the builder needs for one form (its saved draft, its latest published version, the built-in it came from, every published version's
// keys for the alias rule) and binds the builder's callbacks to the audited actions. Loaded once when opened: autosave rewrites the form's doc all the
// time, and the builder must not reload under the user's hands.

export type EditorServices = {
  store: FormStore;
  actor: FormActor;
  catalog: FormCatalog;
  usage: ReadonlyMap<string, FormUsage>;
  nameOf: (uid: string | undefined) => string;
};

type Loaded = Pick<BuilderProps, "baseline" | "untouchedBuiltIn" | "latestPublished" | "builtin" | "builtinChanged" | "nextVersionNumber" | "publishedForms">;

export function EditorHost({ formId, services, onClose, onOpenRescore }: { formId: string; services: EditorServices; onClose: () => void; onOpenRescore?: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const servicesRef = useRef(services);
  useEffect(() => {
    servicesRef.current = services;
  });
  const { store, actor } = services;

  useEffect(() => {
    let alive = true;
    (async () => {
      const { store: s, catalog } = servicesRef.current;
      try {
        const doc = catalog.docs.get(formId) ?? null;
        const builtin = getBuiltinForm(formId);
        const [draft, versions] = await Promise.all([s.getDraft(formId), s.listVersions(formId)]);
        const latest: Form | null = doc?.publishedVersion != null ? (versions.find((v) => v.version === doc.publishedVersion)?.form ?? (await s.getForm(formId, doc.publishedVersion))) : null;
        // an override that was reset to the built-in and has no draft starts again from the built-in, not from the stale override
        const baseline = draft ?? (doc?.baseBuiltInId && !doc.active ? builtin : latest) ?? builtin;
        if (!baseline) throw new Error("That form couldn't be found.");
        if (!alive) return;
        setLoaded({
          baseline,
          untouchedBuiltIn: !doc && !!builtin,
          latestPublished: latest,
          builtin,
          builtinChanged: doc ? builtinChangedSince(doc) : false,
          nextVersionNumber: nextVersion(doc, builtin?.id),
          publishedForms: versions.map((v) => v.form),
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't open that form.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [formId]);

  const loadVersions = useCallback(() => store.listVersions(formId), [store, formId]);

  if (error) {
    return (
      <div className="glass-card flex flex-col items-start gap-3 p-6">
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
        <Button variant="glass" onClick={onClose}>
          Back to forms
        </Button>
      </div>
    );
  }
  if (!loaded) return <div className="glass-card h-64 animate-pulse" aria-label="Opening the form" />;

  const name = loaded.baseline.name;
  return (
    <FormBuilder
      key={formId}
      {...loaded}
      store={store}
      entryCount={services.usage.get(formId)?.total ?? 0}
      usage={services.usage.get(formId)}
      nameOf={services.nameOf}
      loadVersions={loadVersions}
      onPublish={(note, ctx) => publishFormAction(actor, store, formId, name, note, ctx)}
      onRestored={(n) => restoreVersionAction(actor, formId, name, n)}
      onDiscard={() => discardDraftAction(actor, store, formId, name)}
      onClose={onClose}
      onOpenRescore={onOpenRescore}
    />
  );
}

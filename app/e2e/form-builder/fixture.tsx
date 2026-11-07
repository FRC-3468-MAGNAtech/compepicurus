"use client";

import { useEffect, useMemo, useState } from "react";
import { FormsPanelView } from "@/components/forms/forms-panel";
import type { EditorServices } from "@/components/forms/editor-host";
import { FormsContext, buildFormsValue } from "@/lib/forms/forms-context";
import { createMemoryFormStore } from "@/lib/forms/store";
import type { FormStore } from "@/lib/forms/store";
import type { FormUsage } from "@/lib/forms/usage";

declare global {
  interface Window {
    /** Every audit entry the builder wrote, for the tests to read. */
    __audit?: { action: string; target: Record<string, unknown>; before: unknown; after: unknown }[];
  }
}

// Twelve entries on BIOBUZZ, so changes that affect scores or data show the "affects N existing entries" confirmation.
const USAGE: ReadonlyMap<string, FormUsage> = new Map([["biobuzz", { total: 12, byVersion: new Map([[1, 12]]), unversioned: 0 }]]);

export function FormBuilderFixture() {
  const [tick, setTick] = useState(0);
  const [activeForms, setActiveForms] = useState<Record<string, string>>({});
  const [base] = useState(() => createMemoryFormStore({ teamId: "t1", actor: { uid: "u1" } }));
  const [audit] = useState<NonNullable<Window["__audit"]>>(() => []);

  useEffect(() => {
    window.__audit = audit;
  }, [audit]);

  // The same store, but every write re-renders the list (a real account's forms arrive through a Firestore subscription).
  const store = useMemo<FormStore>(() => {
    const bump = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      const r = await fn(...a);
      setTick((t) => t + 1);
      return r;
    };
    return {
      listForms: base.listForms,
      getForm: base.getForm,
      getDraft: base.getDraft,
      listVersions: base.listVersions,
      saveDraft: bump(base.saveDraft),
      discardDraft: bump(base.discardDraft),
      publish: bump(base.publish),
      archive: bump(base.archive),
      resetToBuiltin: bump(base.resetToBuiltin),
    };
  }, [base]);

  const formsValue = useMemo(() => buildFormsValue(base.catalog(), true, activeForms, () => {}), [base, activeForms, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const services = useMemo<EditorServices>(
    () => ({
      store,
      actor: {
        teamId: "t1",
        uid: "u1",
        name: "Ada Admin",
        audit: async (_team, _uid, _name, action, target, before, after) => {
          audit.push({ action, target, before, after });
          setTick((t) => t + 1);
        },
        setActive: async (_team, season, formId) => setActiveForms((a) => ({ ...a, [season]: formId })),
      },
      catalog: formsValue.catalog,
      usage: USAGE,
      nameOf: (uid) => (uid ? "Ada Admin" : "—"),
    }),
    [store, formsValue.catalog, audit]
  );

  return (
    <FormsContext.Provider value={formsValue}>
      <div className="mx-auto w-full max-w-[1600px] px-3 pb-10 pt-4 lg:px-6">
        <FormsPanelView services={services} />
        <p className="mt-6 text-xs text-[var(--muted-foreground)]" data-testid="audit-count">
          {audit.length} audit entries
        </p>
      </div>
    </FormsContext.Provider>
  );
}

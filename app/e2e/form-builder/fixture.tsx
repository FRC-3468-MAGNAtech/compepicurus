"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormsPanelView } from "@/components/forms/forms-panel";
import type { EditorServices } from "@/components/forms/editor-host";
import { FormsContext, buildFormsValue } from "@/lib/forms/forms-context";
import { createMemoryFormStore } from "@/lib/forms/store";
import { createMemoryTemplates, useMemoryTemplates } from "@/lib/templates/memory-service";
import { TemplatesContext } from "@/lib/templates/service";
import { ReviewPanel } from "@/components/templates/review-panel";
import { buildTemplateContent, type FormTemplate } from "@/lib/templates/build";
import { officialTemplates, OFFICIAL_AUTHOR } from "@/lib/templates/official";
import { createBlankForm } from "@/lib/forms/new-form";
import { addField, defaultField } from "@/lib/forms/edit";
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

/** A small valid form for a seeded template: the five categories plus the fields given. */
function seedForm(name: string, fields: string[]) {
  let form = { ...createBlankForm({ id: "seed", name, createdBy: "" }), scoringEnabled: false };
  for (const label of fields) form = addField(form, "teleop", defaultField(form, "toggle", label));
  return form;
}

function seedTemplates(): FormTemplate[] {
  const make = (id: string, over: Partial<FormTemplate> & { name: string; fields: string[] }): FormTemplate => {
    const { fields, ...rest } = over;
    const built = buildTemplateContent({ form: seedForm(rest.name, fields), name: rest.name, description: rest.description, tags: rest.tags });
    if (!built.ok) throw new Error(built.errors.join());
    return { id, visibility: "public", ownerTeamId: "other", authorName: "Team 9999", official: false, version: 1, importCount: 0, reportCount: 0, createdAt: 1, updatedAt: 1, publishedAt: 1, ...built.content, ...rest };
  };
  const official = officialTemplates().map((o, i): FormTemplate => ({ ...o.content, id: o.id, visibility: "public", ownerTeamId: "platform", authorName: OFFICIAL_AUTHOR, official: true, version: 1, importCount: i === 0 ? 7 : 3, reportCount: 0, createdAt: 1, updatedAt: 1, publishedAt: 100 - i }));
  return [
    ...official,
    make("pub-pit", { name: "Pit scouting", description: "Robot inspection checklist", tags: ["pit", "inspection"], authorName: "Team 9999", importCount: 12, publishedAt: 300, fields: ["Wheels checked", "Battery secured"] }),
    make("pub-drive", { name: "Driver feedback", description: "Driver skill notes", tags: ["drive"], authorName: "Team 4242", importCount: 2, publishedAt: 200, fields: ["Smooth driving"] }),
    make("pub-reported", { name: "Suspicious form", description: "Looks odd", tags: ["misc"], authorName: "Team 1", reportCount: 1, publishedAt: 50, fields: ["Odd field"] }),
    make("mine-private", { name: "Our pit form", description: "Private to us", tags: ["pit"], visibility: "private", ownerTeamId: "t1", authorName: "Ada's team", fields: ["Frame inspected"] }),
    make("mine-rejected", { name: "Rejected try", description: "Needs work", tags: ["misc"], visibility: "rejected", ownerTeamId: "t1", authorName: "Ada's team", rejectionReason: "Too generic: add something specific", fields: ["Thing"] }),
    make("mine-public", { name: "Our public form", description: "Shared with everyone", tags: ["shared"], visibility: "public", ownerTeamId: "t1", authorName: "Ada's team", importCount: 1, fields: ["Shared field"] }),
    make("wait-1", { name: "Awaiting review", description: "From another team", tags: ["new"], visibility: "public-pending", authorName: "Team 4242", requestedAt: 5, fields: ["New thing"] }),
  ];
}

export function FormBuilderFixture() {
  // ?role=platform makes the viewer a platform owner too: the Template Review panel shows under the forms
  const platform = useSearchParams().get("role") === "platform";
  const [tick, setTick] = useState(0);
  const [activeForms, setActiveForms] = useState<Record<string, string>>({});
  const [base] = useState(() => createMemoryFormStore({ teamId: "t1", actor: { uid: "u1" } }));
  const [audit] = useState<NonNullable<Window["__audit"]>>(() => []);
  const [templateStore] = useState(() =>
    createMemoryTemplates({
      teamId: "t1",
      isPlatformOwner: platform,
      authorName: "Ada's team",
      seed: seedTemplates(),
      onAudit: (action, target) => audit.push({ action, target, before: null, after: null }),
    })
  );
  const templateService = useMemoryTemplates(templateStore);

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
      <TemplatesContext.Provider value={templateService}>
      <div className="mx-auto w-full max-w-[1600px] px-3 pb-10 pt-4 lg:px-6">
        <FormsPanelView services={services} />
        {platform && (
          <div className="mt-10">
            <ReviewPanel />
          </div>
        )}
        <p className="mt-6 text-xs text-[var(--muted-foreground)]" data-testid="audit-count">
          {audit.length} audit entries
        </p>
      </div>
      </TemplatesContext.Provider>
    </FormsContext.Provider>
  );
}

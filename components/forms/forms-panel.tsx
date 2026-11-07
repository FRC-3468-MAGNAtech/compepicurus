"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, BookmarkPlus, Copy, Download, Eye, FilePlus2, GitCompare, Pencil, RefreshCw, RotateCcw, Star } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/forms/builder/diff-view";
import { EditorHost, type EditorServices } from "@/components/forms/editor-host";
import { NewFormDialog, type NewFormChoice } from "@/components/forms/new-form-dialog";
import { TemplateLibrary } from "@/components/templates/template-library";
import { TemplateDetailsDialog } from "@/components/templates/template-dialogs";
import { UpdateAvailableDialog } from "@/components/templates/update-available-dialog";
import { TemplatesProvider } from "@/lib/templates/firestore-service";
import { useTemplates } from "@/lib/templates/service";
import { formFromTemplate, updateAvailable, type FormTemplate } from "@/lib/templates/build";
import { useFormAdmin } from "@/lib/forms/use-form-admin";
import { archiveFormAction, createFormAction, resetFormAction, setActiveFormAction } from "@/lib/forms/actions";
import { diffForms } from "@/lib/forms/diff";
import { duplicateAsNewForm } from "@/lib/forms/create";
import { canBeActive, type FormSummary } from "@/lib/forms/resolve";
import { exportFormJson } from "@/lib/forms/portable";
import { getBuiltinForm } from "@/lib/forms/builtin";
import { useForms } from "@/lib/forms/forms-context";
import { usePermissions } from "@/lib/permissions";
import { SEASONS } from "@/lib/seasons";
import { downloadTextFile } from "@/lib/download";
import type { Form } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P22: Admin Panel > Forms. Every form the account can use (built-in, custom, from template), with its status, version, which season it's active for,
// who last edited it and how many entries it has; and the actions: Edit, Duplicate, Export JSON, Archive, Set as active, Reset to built-in, View
// changes from built-in. "New form" starts one from scratch, from a template (P23), by duplicating, or by importing. Owner and admin only.

const ORIGIN_LABEL: Record<FormSummary["origin"], string> = { "built-in": "Built-in", "built-in-override": "Built-in (edited)", custom: "Custom", template: "From template" };

type Confirm = { kind: "archive" | "unarchive" | "reset"; id: string };

/** The Admin Panel tab: gates on `can('manageForms')`, binds the account's store, and shows the list. */
export function FormsPanel({ onOpenRescore }: { onOpenRescore?: () => void }) {
  const { can } = usePermissions();
  const admin = useFormAdmin();
  const forms = useForms();
  const services = useMemo<EditorServices | null>(() => {
    if (!admin.store || !admin.actor) return null;
    return { store: admin.store, actor: admin.actor, catalog: forms.catalog, usage: admin.usage, nameOf: admin.nameOf };
  }, [admin.store, admin.actor, admin.usage, admin.nameOf, forms.catalog]);

  if (!can("manageForms")) {
    return (
      <GlassPanel className="text-sm text-[var(--muted-foreground)]" role="alert">
        Only the team owner and admins can manage forms.
      </GlassPanel>
    );
  }
  if (!services) return <div className="glass-card h-40 animate-pulse" />;
  return (
    <TemplatesProvider>
      <FormsPanelView services={services} onOpenRescore={onOpenRescore} />
    </TemplatesProvider>
  );
}

/** The list itself, given its services (the Playwright fixture page supplies an in-memory store). */
export function FormsPanelView({ onOpenRescore, services: svc }: { onOpenRescore?: () => void; services: EditorServices }) {
  const forms = useForms();

  const tpl = useTemplates();
  const [view, setView] = useState<"forms" | "templates">("forms");
  const [templateTab, setTemplateTab] = useState<"public" | "mine">("public");
  const [saveFor, setSaveFor] = useState<string | null>(null);
  const [updateFor, setUpdateFor] = useState<string | null>(null);
  /** The newest version of each template one of our forms came from (null: it's gone or we can't read it). */
  const [sourceTemplates, setSourceTemplates] = useState<Record<string, FormTemplate | null>>({});
  const effectiveForm = (id: string): Form | null => forms.latest(id) ?? svc.catalog.docs.get(id)?.draft ?? getBuiltinForm(id);
  const templateIds = [...new Set(forms.summaries.map((x) => effectiveForm(x.id)?.templateId).filter((x): x is string => !!x))].sort().join(",");
  const { getTemplate } = tpl;
  useEffect(() => {
    let alive = true;
    for (const id of templateIds ? templateIds.split(",") : []) {
      getTemplate(id)
        .then((t) => alive && setSourceTemplates((prev) => ({ ...prev, [id]: t })))
        .catch(() => alive && setSourceTemplates((prev) => ({ ...prev, [id]: null })));
    }
    return () => {
      alive = false;
    };
  }, [templateIds, getTemplate]);

  const loadChanges = useCallback(async (id: string) => {
    const original = getBuiltinForm(id);
    const doc = svc.catalog.docs.get(id);
    const ours = doc?.draft ?? (doc?.publishedVersion != null ? await svc.store.getForm(id, doc.publishedVersion) : null);
    return original && ours ? { from: original, to: ours, draft: !!doc?.draft } : null;
  }, [svc]);

  const [editing, setEditing] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [activeFor, setActiveFor] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (editing) return <EditorHost formId={editing} services={svc} onClose={() => setEditing(null)} onOpenRescore={onOpenRescore} />;

  const { store, actor, catalog, usage } = svc;
  const summaries = forms.summaries;
  const visible = summaries.filter((s) => showArchived || !s.archived);
  const archivedCount = summaries.filter((s) => s.archived).length;
  const nameOfForm = (id: string) => summaries.find((s) => s.id === id)?.name ?? id;
  const seasonsActiveFor = (id: string) => SEASONS.filter((se) => se.enabled && forms.activeFormIdFor(se.id) === id);

  /** What scouts see for a form now, or its draft when it was never published. */
  const effective = effectiveForm;

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const useTemplate = async (t: FormTemplate, name: string) => {
    const full = await tpl.use(t.id);
    const form = formFromTemplate(full, { name, taken: new Set(summaries.map((x) => x.id)), createdBy: actor.uid, now: Date.now() });
    await createFormAction(actor, store, form, "template", { templateId: full.id, templateVersion: full.version });
    setView("forms"); // closing the builder returns to the forms, where the new draft is
    setEditing(form.id);
  };

  const create = async (choice: NewFormChoice) => {
    await createFormAction(actor, store, choice.form, choice.how, choice.from ? { from: choice.from } : {});
    setEditing(choice.form.id);
  };

  const doConfirm = () =>
    run(async () => {
      if (!confirm) return;
      const s = summaries.find((x) => x.id === confirm.id);
      const doc = catalog.docs.get(confirm.id);
      if (confirm.kind === "reset") await resetFormAction(actor, store, confirm.id, s?.name ?? confirm.id, doc?.publishedVersion ?? null);
      else await archiveFormAction(actor, store, confirm.id, s?.name ?? confirm.id, confirm.kind === "archive", usage.get(confirm.id)?.total ?? 0);
      setConfirm(null);
    }, confirm?.kind === "reset" ? "Reset to the built-in. Scouts now use the original; entries scouted with your version still read correctly." : confirm?.kind === "archive" ? "Archived." : "Restored from the archive.");

  const confirmS = confirm ? summaries.find((s) => s.id === confirm.id) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="forms-panel">
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Forms</h2>
          <p className="text-sm text-[var(--muted-foreground)]">The scouting forms your team can use. Edit one, or make a new one; scouts fill in the form that&apos;s active for the season.</p>
        </div>
        <Button className="gap-2" onClick={() => setNewOpen(true)} data-testid="new-form">
          <FilePlus2 className="h-4 w-4" /> New form
        </Button>
      </GlassPanel>

      {notice && (
        <p role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <div className="glass-pill inline-flex self-start p-0.5 text-sm" role="group" aria-label="Forms or templates">
        {(["forms", "templates"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("min-h-10 rounded-full px-5 font-medium", view === v && "text-[var(--color-primary-foreground)]")} style={view === v ? { background: "var(--theme-gradient)" } : undefined} data-testid={`view-${v}`}>
            {v === "forms" ? "Forms" : "Templates"}
          </button>
        ))}
      </div>

      {view === "templates" ? (
        <TemplateLibrary forms={summaries.map((x) => ({ id: x.id, name: x.name, form: effective(x.id) }))} onUse={useTemplate} tab={templateTab} onTabChange={setTemplateTab} />
      ) : (
      <>
      <ul className="grid gap-3 lg:grid-cols-2" aria-label="Forms">
        {visible.map((s) => {
          const doc = catalog.docs.get(s.id);
          const seasons = seasonsActiveFor(s.id);
          const entries = usage.get(s.id)?.total ?? 0;
          const editable = !s.archived;
          const eff = effective(s.id);
          return (
            <li key={s.id}>
              <GlassPanel className={cn("flex h-full flex-col gap-3", s.archived && "opacity-70")} data-form-card={s.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold">{s.name}</h3>
                    <p className="font-mono text-[11px] text-[var(--muted-foreground)]">{s.id}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge variant={s.origin === "built-in" ? "outline" : "glass"}>{ORIGIN_LABEL[s.origin]}</Badge>
                    {s.status === "draft" ? <Badge variant="warning">Draft</Badge> : <Badge variant="success">Published{s.version ? ` v${s.version}` : ""}</Badge>}
                    {s.hasDraft && s.status === "published" && <Badge variant="warning">Unpublished changes</Badge>}
                    {s.archived && <Badge variant="outline">Archived</Badge>}
                    {s.builtinChanged && <Badge variant="warning">Built-in changed</Badge>}
                    {updateAvailable(eff ?? {}, eff?.templateId ? sourceTemplates[eff.templateId] : null) && <Badge variant="warning">Update available</Badge>}
                  </div>
                </div>

                {eff?.description && <p className="text-sm text-[var(--muted-foreground)]">{eff.description}</p>}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Active for</dt>
                    <dd className="font-medium">{seasons.length > 0 ? seasons.map((x) => x.name).join(", ") : "No season"}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Entries</dt>
                    <dd className="font-medium tabular-nums">{entries}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[var(--muted-foreground)]">Last edited</dt>
                    <dd className="font-medium">{doc?.updatedAt ? `${svc.nameOf(doc.updatedBy)}, ${new Date(doc.updatedAt).toLocaleString()}` : s.origin === "built-in" ? "Built into the app" : "—"}</dd>
                  </div>
                </dl>

                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  {editable && (
                    <Button size="sm" className="gap-1.5" onClick={() => setEditing(s.id)} aria-label={`Edit ${s.name}`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  <Action
                    icon={Copy}
                    label="Duplicate"
                    aria={`Duplicate ${s.name}`}
                    disabled={!eff || busy}
                    onClick={() =>
                      eff &&
                      run(async () => {
                        const copy = duplicateAsNewForm(eff, { name: `${s.name} (copy)`, taken: new Set(summaries.map((x) => x.id)), createdBy: actor.uid, now: Date.now() });
                        await createFormAction(actor, store, copy, "duplicate", { from: s.id });
                        setEditing(copy.id);
                      })
                    }
                  />
                  <Action icon={BookmarkPlus} label="Save as template" aria={`Save ${s.name} as a template`} disabled={!eff || busy} onClick={() => setSaveFor(s.id)} />
                  {updateAvailable(eff ?? {}, eff?.templateId ? sourceTemplates[eff.templateId] : null) && <Action icon={RefreshCw} label="Review update" aria={`Review the template update for ${s.name}`} onClick={() => setUpdateFor(s.id)} />}
                  <Action icon={Download} label="Export JSON" aria={`Export ${s.name} as JSON`} disabled={!eff} onClick={() => eff && downloadTextFile(`${s.id}.form.json`, exportFormJson(eff), "application/json")} />
                  {editable && (
                    <Action icon={Star} label="Set as active" aria={`Set ${s.name} as active`} disabled={busy || !canBeActive(catalog, s.id)} title={!canBeActive(catalog, s.id) ? "Publish it first" : undefined} onClick={() => setActiveFor(s.id)} />
                  )}
                  {s.overridden || (s.origin !== "built-in" && !!doc?.baseBuiltInId) ? <Action icon={GitCompare} label="View changes from built-in" aria={`View changes in ${s.name} from the built-in`} onClick={() => setDiffFor(s.id)} /> : null}
                  {(s.overridden || (!!doc?.baseBuiltInId && doc.active)) && <Action icon={RotateCcw} label="Reset to built-in" aria={`Reset ${s.name} to the built-in`} disabled={busy} onClick={() => setConfirm({ kind: "reset", id: s.id })} />}
                  {s.archived ? (
                    <Action icon={ArchiveRestore} label="Unarchive" aria={`Unarchive ${s.name}`} disabled={busy} onClick={() => setConfirm({ kind: "unarchive", id: s.id })} />
                  ) : (
                    <Action icon={Archive} label="Archive" aria={`Archive ${s.name}`} disabled={busy || seasons.length > 0} title={seasons.length > 0 ? "It's active for a season: set another form active first" : undefined} onClick={() => setConfirm({ kind: "archive", id: s.id })} />
                  )}
                </div>
              </GlassPanel>
            </li>
          );
        })}
      </ul>

      {archivedCount > 0 && (
        <Button variant="ghost" size="sm" className="gap-1.5 self-start" onClick={() => setShowArchived((v) => !v)}>
          <Eye className="h-4 w-4" /> {showArchived ? "Hide" : "Show"} {archivedCount} archived
        </Button>
      )}
      <p className="text-xs text-[var(--muted-foreground)]">Forms are archived, never deleted: every saved entry keeps the form it was scouted with, so it can always be shown.</p>
      </>
      )}

      <TemplateDetailsDialog
        open={!!saveFor}
        onClose={() => setSaveFor(null)}
        title="Save as template"
        intro="Saves a copy of this form as a private template that only your account can see. You can ask to publish it publicly from the Templates tab."
        confirmLabel="Save template"
        initial={{ name: saveFor ? nameOfForm(saveFor) : "", description: (saveFor && effective(saveFor)?.description) || "", tags: (saveFor && effective(saveFor)?.tags) || [] }}
        onSave={async (v) => {
          const form = saveFor ? effective(saveFor) : null;
          if (!form) throw new Error("That form isn't available.");
          await tpl.create({ form, ...v });
          setNotice("Saved as a private template.");
          setTemplateTab("mine");
          setView("templates");
        }}
      />
      <UpdateAvailableDialog
        form={updateFor ? effective(updateFor) : null}
        template={updateFor ? (sourceTemplates[effective(updateFor)?.templateId ?? ""] ?? null) : null}
        onClose={() => setUpdateFor(null)}
        onCreate={async (t) => {
          const current = updateFor ? effective(updateFor) : null;
          const full = await tpl.use(t.id);
          const form = formFromTemplate(full, { name: `${current?.name ?? t.name} (v${full.version})`, taken: new Set(summaries.map((x) => x.id)), createdBy: actor.uid, now: Date.now() });
          await createFormAction(actor, store, form, "template", { templateId: full.id, templateVersion: full.version, updateOf: updateFor });
          setView("forms");
          setEditing(form.id);
        }}
      />
      <NewFormDialog
        onPickTemplate={() => setView("templates")}
        open={newOpen}
        onOpenChange={setNewOpen}
        existing={summaries.map((s) => ({ id: s.id, name: s.name, form: effective(s.id) }))}
        takenIds={new Set(summaries.map((s) => s.id))}
        createdBy={actor.uid}
        onCreate={create}
      />

      <Dialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>{confirm?.kind === "reset" ? "Reset to the built-in?" : confirm?.kind === "archive" ? "Archive this form?" : "Unarchive this form?"}</DialogTitle>
          <DialogDescription>
            {confirm?.kind === "reset" && `Scouts go back to the original ${confirmS?.name}. Your edited versions stay in the history, and every entry already scouted with them still reads correctly. Any unpublished changes are discarded.`}
            {confirm?.kind === "archive" && `“${confirmS?.name}” can no longer be edited or set active. ${usage.get(confirm.id)?.total ?? 0} saved entries keep using it and stay in analytics. You can unarchive it later.`}
            {confirm?.kind === "unarchive" && `“${confirmS?.name}” becomes editable and can be set active again.`}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={confirm?.kind === "reset" ? "danger" : "primary"} onClick={() => void doConfirm()} disabled={busy}>
              {confirm?.kind === "reset" ? "Reset to built-in" : confirm?.kind === "archive" ? "Archive" : "Unarchive"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SetActiveDialog
        formId={activeFor}
        name={activeFor ? nameOfForm(activeFor) : ""}
        onClose={() => setActiveFor(null)}
        activeIdFor={forms.activeFormIdFor}
        nameOfForm={nameOfForm}
        busy={busy}
        onSet={(seasonId, prev) =>
          run(async () => {
            if (!activeFor) return;
            await setActiveFormAction(actor, seasonId, activeFor, nameOfForm(activeFor), prev);
            setActiveFor(null);
          }, "Scouts will fill in this form from their next load.")
        }
      />

      <ChangesDialog
        formId={diffFor}
        name={diffFor ? nameOfForm(diffFor) : ""}
        onClose={() => setDiffFor(null)}
        load={loadChanges}
      />
    </div>
  );
}

function Action({ icon: Icon, label, aria, onClick, disabled, title }: { icon: typeof Copy; label: string; aria: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <Button variant="glass" size="sm" className="gap-1.5" aria-label={aria} title={title} disabled={disabled} onClick={onClick}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}

function SetActiveDialog({
  formId,
  name,
  onClose,
  activeIdFor,
  nameOfForm,
  busy,
  onSet,
}: {
  formId: string | null;
  name: string;
  onClose: () => void;
  activeIdFor: (seasonId?: string) => string;
  nameOfForm: (id: string) => string;
  busy: boolean;
  onSet: (seasonId: string, previousFormId: string) => void;
}) {
  const seasons = SEASONS.filter((s) => s.enabled);
  return (
    <Dialog open={!!formId} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogTitle>Set “{name}” as active</DialogTitle>
        <DialogDescription>Scouts fill in the active form for the season. Pick the season to use it for. Entries already saved keep the form they were scouted with.</DialogDescription>
        <ul className="mt-4 flex flex-col gap-2">
          {seasons.map((s) => {
            const current = activeIdFor(s.id);
            const already = current === formId;
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--glass-border)] px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="truncate text-xs text-[var(--muted-foreground)]">Now: {nameOfForm(current)}</div>
                </div>
                <Button size="sm" disabled={already || busy} onClick={() => onSet(s.id, current)} aria-label={`Use for ${s.name}`}>
                  {already ? "Active" : "Use for this season"}
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangesDialog({ formId, name, onClose, load }: { formId: string | null; name: string; onClose: () => void; load: (id: string) => Promise<{ from: Form; to: Form; draft: boolean } | null> }) {
  const [state, setState] = useState<{ id: string; result: { from: Form; to: Form; draft: boolean } | null } | { id: string; error: string } | null>(null);
  useEffect(() => {
    if (!formId) return;
    let alive = true;
    load(formId)
      .then((result) => alive && setState({ id: formId, result }))
      .catch((e) => alive && setState({ id: formId, error: e instanceof Error ? e.message : "Couldn't load the changes." }));
    return () => {
      alive = false;
    };
  }, [formId, load]);
  const mine = state && state.id === formId ? state : null;
  const error = mine && "error" in mine ? mine.error : null;
  const loaded = mine && "result" in mine ? mine.result : undefined;
  return (
    <Dialog open={!!formId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(96vw,720px)] max-h-[88vh] overflow-y-auto">
        <DialogTitle>Changes in “{name}” from the built-in</DialogTitle>
        <DialogDescription>{loaded?.draft ? "Your unpublished draft compared with the original that ships with the app." : "Your published version compared with the original that ships with the app."}</DialogDescription>
        <div className="mt-4">
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          {!error && loaded === undefined && <div className="glass-card h-24 animate-pulse" />}
          {!error && loaded === null && <p className="text-sm text-[var(--muted-foreground)]">There&apos;s nothing to compare: this form has no edited version.</p>}
          {loaded && <DiffView diff={diffForms(loaded.from, loaded.to)} emptyText="Identical to the built-in." />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

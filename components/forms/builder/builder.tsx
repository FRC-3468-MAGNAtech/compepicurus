"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, History as HistoryIcon, Keyboard, Loader2, Redo2, Rocket, Undo2, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { BuilderContext, type BuilderApi, type BuilderSelection } from "@/components/forms/builder/context";
import { BuilderDnd } from "@/components/forms/builder/dnd";
import { Canvas } from "@/components/forms/builder/canvas";
import { Palette } from "@/components/forms/builder/palette";
import { FieldInspector } from "@/components/forms/builder/field-inspector";
import { SectionInspector } from "@/components/forms/builder/section-inspector";
import { FormInspector } from "@/components/forms/builder/form-inspector";
import { LivePreview } from "@/components/forms/builder/preview";
import { AnalyticsPreview } from "@/components/forms/builder/analytics-preview";
import { ScoringSummary } from "@/components/forms/builder/scoring-summary";
import { ValidationPanel } from "@/components/forms/builder/validation-panel";
import { PublishDialog } from "@/components/forms/builder/publish-dialog";
import { HistoryDialog } from "@/components/forms/builder/history-dialog";
import { ShortcutsDialog } from "@/components/forms/builder/shortcuts-dialog";
import { diffForms } from "@/lib/forms/diff";
import { duplicateField, findField, isSystemField, keysOf, moveFieldBy, removeField } from "@/lib/forms/edit";
import { canRedo, canUndo, createHistory, pushHistory, redo, undo, type History } from "@/lib/forms/history";
import { createBlankForm } from "@/lib/forms/new-form";
import type { FormStore } from "@/lib/forms/store";
import type { FormVersion } from "@/lib/forms/resolve";
import type { FormUsage } from "@/lib/forms/usage";
import { blockingIssues, checkForm, parseForm, type FormIssue } from "@/lib/forms/validate";
import type { Form } from "@/lib/forms/types";
import type { PublishContext } from "@/lib/forms/actions";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

// P22: the Form Builder. Palette (left), canvas (centre), inspector and panels (right), collapsing into tabs on small screens. The form being edited is
// a value in an undo/redo history (lib/forms/history.ts); every change goes through `update`, which also schedules the debounced draft autosave.
// Nothing here knows how a form is stored: it is given a `store` (saveDraft), and callbacks for the audited actions (publish, restore, discard).

export const AUTOSAVE_MS = 1500;

type SaveState = "saved" | "saving" | "unsaved" | "error" | "invalid";
type PanelTab = "inspect" | "preview" | "analytics" | "scoring" | "problems";

export type BuilderProps = {
  /** The working copy to start from: the saved draft, else the latest published version, else the built-in. */
  baseline: Form;
  /** `baseline` is an untouched built-in: the first edit creates the account's own copy (copy-on-write). */
  untouchedBuiltIn: boolean;
  /** The latest published version of this account's form (null when never published). */
  latestPublished: Form | null;
  /** The code-defined original, when this is (an override of) a built-in. */
  builtin: Form | null;
  /** The original has changed in code since this override was made. */
  builtinChanged?: boolean;
  /** Version number the next publish will take. */
  nextVersionNumber: number;
  /** Every published version's keys (for the alias rule), loaded by the caller. */
  publishedForms: Form[];
  store: FormStore;
  entryCount: number;
  usage: FormUsage | undefined;
  nameOf: (uid: string | undefined) => string;
  loadVersions: () => Promise<FormVersion[]>;
  onPublish: (note: string, ctx: PublishContext) => Promise<number>;
  onRestored: (restoredVersion: number) => Promise<void>;
  onDiscard: () => Promise<void>;
  onClose: () => void;
  onOpenRescore?: () => void;
};

function normalizeRestored(restored: Form, working: Form): Form {
  return {
    ...restored,
    id: working.id,
    version: working.version,
    status: "draft",
    origin: working.origin,
    createdBy: working.createdBy,
    ...(working.baseBuiltInId ? { baseBuiltInId: working.baseBuiltInId, baseBuiltInHash: working.baseBuiltInHash } : {}),
  };
}

function isTyping(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
}

export function FormBuilder(props: BuilderProps) {
  const { baseline, store, latestPublished, builtin, onClose } = props;
  const compact = !useMediaQuery("(min-width: 1024px)");
  const [history, setHistory] = useState<History<Form>>(() => createHistory(baseline));
  // The latest history, readable synchronously: every change goes through `commit`, so `update(fn)` runs `fn` right away (callers read what it produced, e.g. the id of a
  // field it added, to select it) and two edits in one event both see the first.
  const historyRef = useRef(history);
  const commit = useCallback((fn: (h: History<Form>) => History<Form>) => {
    historyRef.current = fn(historyRef.current);
    setHistory(historyRef.current);
  }, []);
  const [savedForm, setSavedForm] = useState<Form>(baseline);
  const [persistStatus, setPersistStatus] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<BuilderSelection>({ kind: "form" });
  const [tab, setTab] = useState<PanelTab>("inspect");
  const [publishedNow, setPublishedNow] = useState<Form | null>(latestPublished);
  const [nextNumber, setNextNumber] = useState(props.nextVersionNumber);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "publish" | "history" | "shortcuts" | "leave" | "discard">(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copyNoticeShown, setCopyNoticeShown] = useState(true);
  const form = history.present;
  const dirty = form !== savedForm;

  // ---- editing -------------------------------------------------------------------------------------------------
  const update = useCallback((fn: (f: Form) => Form, coalesceKey?: string) => {
    commit((h) => pushHistory(h, fn(h.present), { coalesceKey }));
  }, [commit]);
  const select = useCallback((s: BuilderSelection) => {
    setSelection(s);
    setTab("inspect");
  }, []);

  // A selection can outlive the thing it points at (deleted, or undone away): fall back to the form settings.
  const effectiveSelection = useMemo<BuilderSelection>(() => {
    if (selection.kind === "field" && !findField(form, selection.id)) return { kind: "form" };
    if (selection.kind === "section" && !form.sections.some((s) => s.id === selection.id)) return { kind: "form" };
    return selection;
  }, [selection, form]);

  // ---- problems ------------------------------------------------------------------------------------------------
  const issues = useMemo<FormIssue[]>(() => {
    const parsed = parseForm(form);
    const list = checkForm(form);
    if (!parsed.ok) return [{ severity: "error", code: "invalid-structure", message: `This form can't be saved yet: ${parsed.issues[0]?.message ?? "something is invalid"}${parsed.issues[0]?.path ? ` (${parsed.issues[0].path})` : ""}.` }, ...list];
    return list;
  }, [form]);
  const errors = useMemo(() => blockingIssues(issues), [issues]);
  const publishedKeys = useMemo(() => keysOf([...props.publishedForms, ...(builtin ? [builtin] : []), ...(publishedNow ? [publishedNow] : [])]), [props.publishedForms, builtin, publishedNow]);

  // ---- autosave --------------------------------------------------------------------------------------------------
  const savingRef = useRef(false);
  const persist = useCallback(
    async (target: Form): Promise<boolean> => {
      savingRef.current = true;
      setPersistStatus("saving");
      setSaveError(null);
      try {
        await store.saveDraft(target);
        setSavedForm(target);
        setPersistStatus("idle");
        return true;
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Couldn't save.");
        setPersistStatus("error");
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [store]
  );

  // What the indicator shows is derived: nothing to save, a save in flight, a failed save, a form that can't be saved yet, or changes waiting for the debounce.
  const parsedOk = useMemo(() => parseForm(form).ok, [form]);
  const saveState: SaveState = persistStatus === "saving" ? "saving" : !dirty ? "saved" : persistStatus === "error" ? "error" : !parsedOk ? "invalid" : "unsaved";

  useEffect(() => {
    if (form === savedForm || !parsedOk) return;
    const t = setTimeout(() => {
      if (!savingRef.current) void persist(form);
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [form, savedForm, parsedOk, persist]);

  /** Saves right now if there's anything unsaved. Resolves false when it can't (invalid, or the write failed). */
  const flush = useCallback(async (): Promise<boolean> => {
    if (form === savedForm) return true;
    if (!parseForm(form).ok) return false;
    return persist(form);
  }, [form, savedForm, persist]);

  useEffect(() => {
    if (!dirty && saveState !== "saving") return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saveState]);

  // ---- leaving ---------------------------------------------------------------------------------------------------------
  const requestClose = useCallback(async () => {
    if (!dirty) return onClose();
    if (await flush()) onClose();
    else setDialog("leave");
  }, [dirty, flush, onClose]);

  // ---- publish -----------------------------------------------------------------------------------------------------------
  const publishBase = publishedNow ?? builtin;
  const publishDiff = useMemo(() => diffForms(publishBase ?? createBlankForm({ id: form.id, name: form.name, createdBy: "" }), form), [publishBase, form]);
  const hasUnpublished = useMemo(() => (publishBase ? !diffForms(publishBase, form).empty : true), [publishBase, form]);
  const baseLabel = publishedNow ? `version ${publishedNow.version}` : builtin ? "the built-in" : "an empty form";

  const openPublish = async () => {
    setPublishError(null);
    if (!(await flush())) {
      setPublishError(saveError ?? "Fix the problems first: the draft couldn't be saved.");
      setDialog("publish");
      return;
    }
    setDialog("publish");
  };

  const doPublish = async (note: string) => {
    setPublishing(true);
    setPublishError(null);
    try {
      if (!(await flush())) throw new Error("The draft couldn't be saved, so it wasn't published.");
      const version = await props.onPublish(note, { previousVersion: publishedNow?.version ?? null, diff: publishDiff, affectedEntries: props.entryCount, formName: form.name });
      setPublishedNow({ ...form, version, status: "published" });
      setNextNumber(version + 1);
      setSavedForm(form);
      setDialog(null);
      setNotice(`Published version ${version}. Scouts get it from their next load.`);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Couldn't publish.");
    } finally {
      setPublishing(false);
    }
  };

  const doRestore = async (restored: Form) => {
    const next = normalizeRestored(restored, form);
    commit((h) => pushHistory(h, next, {}));
    if (!(await persist(next))) throw new Error("Couldn't save the restored draft.");
    await props.onRestored(restored.version);
    setNotice(`Version ${restored.version} is in your draft. Review it, then publish it as a new version.`);
  };

  const doDiscard = async () => {
    await props.onDiscard();
    setDialog(null);
    onClose();
  };

  // ---- keyboard ------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        commit((h) => undo(h));
      } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        commit((h) => redo(h));
      } else if (mod && key === "s") {
        e.preventDefault();
        void flush();
      } else if (isTyping(e.target)) {
        return;
      } else if (e.key === "?") {
        setDialog("shortcuts");
      } else if (e.key === "Escape") {
        setSelection({ kind: "form" });
      } else if (effectiveSelection.kind === "field" && !compact) {
        const id = effectiveSelection.id;
        const hit = findField(form, id);
        if (!hit) return;
        if (mod && key === "d" && !isSystemField(hit.field)) {
          e.preventDefault();
          const r = duplicateField(form, id);
          if (r.id) {
            update(() => r.form);
            setSelection({ kind: "field", id: r.id });
          }
        } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          update((f) => moveFieldBy(f, id, e.key === "ArrowUp" ? -1 : 1));
        } else if ((e.key === "Delete" || e.key === "Backspace") && !isSystemField(hit.field)) {
          e.preventDefault();
          update((f) => removeField(f, id));
          setSelection({ kind: "form" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [effectiveSelection, form, compact, flush, update, commit]);

  // ---- render --------------------------------------------------------------------------------------------------------------------
  const api: BuilderApi = { form, update, selection: effectiveSelection, select, publishedKeys, issues, compact, entryCount: props.entryCount };
  const showCopyNotice = props.untouchedBuiltIn && !dirty && savedForm === baseline && copyNoticeShown;

  const inspector = (
    <div className="flex flex-col gap-3">
      {effectiveSelection.kind === "field" ? (
        (() => {
          const hit = findField(form, effectiveSelection.id);
          return hit ? <FieldInspector key={hit.field.id} field={hit.field} /> : null;
        })()
      ) : effectiveSelection.kind === "section" ? (
        <SectionInspector key={effectiveSelection.id} sectionId={effectiveSelection.id} />
      ) : (
        <FormInspector />
      )}
    </div>
  );

  const panels = (
    <div className="flex min-w-0 flex-col gap-3">
      <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)}>
        <TabsList className="max-w-full overflow-x-auto text-xs">
          <TabsTrigger className="px-3" value="inspect">{compact ? "Edit" : "Inspector"}</TabsTrigger>
          <TabsTrigger className="px-3" value="preview">Preview</TabsTrigger>
          <TabsTrigger className="px-3" value="analytics">Analytics</TabsTrigger>
          <TabsTrigger className="px-3" value="scoring">Scoring</TabsTrigger>
          <TabsTrigger className="px-3" value="problems">
            Problems
            {issues.length > 0 && (
              <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums", errors.length > 0 ? "bg-red-500/80 text-white" : "bg-amber-400/80 text-black")} aria-label={`${errors.length} errors, ${issues.length - errors.length} tips`}>
                {errors.length > 0 ? errors.length : issues.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-w-0" role="tabpanel">
        {tab === "inspect" && inspector}
        {tab === "preview" && <LivePreview form={form} />}
        {tab === "analytics" && <AnalyticsPreview form={form} />}
        {tab === "scoring" && <ScoringSummary form={form} />}
        {tab === "problems" && <ValidationPanel />}
      </div>
    </div>
  );

  const [mobilePane, setMobilePane] = useState<"structure" | "details">("structure");

  return (
    <BuilderContext.Provider value={api}>
      <BuilderDnd>
        <div className="flex flex-col gap-4" data-testid="form-builder">
          <GlassPanel className="flex flex-wrap items-center gap-2 p-3">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void requestClose()} aria-label="Back to forms">
              <ArrowLeft className="h-4 w-4" /> Forms
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold" data-testid="builder-title">
                  {form.name}
                </h2>
                {publishedNow ? <Badge variant="success">v{publishedNow.version} live</Badge> : builtin ? <Badge variant="outline">Built-in v{builtin.version}</Badge> : <Badge variant="warning">Never published</Badge>}
                {hasUnpublished && publishedNow && <Badge variant="outline">unpublished changes</Badge>}
                {props.entryCount > 0 && <Badge variant="outline">{props.entryCount} entries</Badge>}
              </div>
              <SaveIndicator state={saveState} error={saveError} invalidMessage={errors.find((e) => e.code === "invalid-structure")?.message} onRetry={() => void persist(form)} />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo(history)} onClick={() => commit((h) => undo(h))}>
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!canRedo(history)} onClick={() => commit((h) => redo(h))}>
                <Redo2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Version history" title="Version history" onClick={() => setDialog("history")}>
                <HistoryIcon className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setDialog("shortcuts")}>
                <Keyboard className="h-4 w-4" />
              </Button>
              {(publishedNow || builtin) && hasUnpublished && (
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setDialog("discard")}>
                  <Undo className="h-4 w-4" /> Discard changes
                </Button>
              )}
              <Button className="gap-2" disabled={!hasUnpublished} onClick={() => void openPublish()} data-testid="publish-button">
                <Rocket className="h-4 w-4" /> Publish
              </Button>
            </div>
          </GlassPanel>

          {notice && (
            <div role="status" className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> {notice}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            </div>
          )}
          {showCopyNotice && (
            <div role="note" className="flex items-start justify-between gap-2 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200" data-testid="copy-on-write-notice">
              <span>
                <strong>You&apos;re editing the built-in {baseline.name} form.</strong> Your first edit makes your team&apos;s own copy (an override). Scouts keep using the built-in until you publish, and you can reset to the built-in at any time.
              </span>
              <Button variant="ghost" size="sm" onClick={() => setCopyNoticeShown(false)}>
                Got it
              </Button>
            </div>
          )}
          {props.builtinChanged && (
            <div role="note" className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>The built-in form this copy was made from has changed since. Your copy is unaffected: compare with &ldquo;View changes from built-in&rdquo; in the forms list.</span>
            </div>
          )}
          {compact && (
            <p role="note" className="rounded-2xl border border-[var(--glass-border)] bg-white/[0.04] px-3 py-2 text-xs text-[var(--muted-foreground)]" data-testid="compact-note">
              Full editing works best on a larger screen. Here you can browse the structure, preview the form and make simple field edits.
            </p>
          )}

          {compact ? (
            <div className="flex flex-col gap-3">
              <div className="glass-pill inline-flex self-start p-0.5 text-sm" role="group" aria-label="Builder view">
                {(["structure", "details"] as const).map((p) => (
                  <button key={p} type="button" aria-pressed={mobilePane === p} onClick={() => setMobilePane(p)} className={cn("min-h-10 rounded-full px-4", mobilePane === p && "text-[var(--color-primary-foreground)]")} style={mobilePane === p ? { background: "var(--theme-gradient)" } : undefined}>
                    {p === "structure" ? "Structure" : "Edit & preview"}
                  </button>
                ))}
              </div>
              {mobilePane === "structure" ? <Canvas /> : panels}
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_24rem] xl:grid-cols-[16rem_minmax(0,1fr)_28rem]">
              <aside aria-label="Palette" className="glass-card max-h-[calc(100dvh-9rem)] overflow-y-auto p-3 lg:sticky lg:top-4">
                <Palette />
              </aside>
              <main aria-label="Canvas" className="min-w-0">
                <Canvas />
              </main>
              <aside aria-label="Inspector and panels" className="glass-card max-h-[calc(100dvh-9rem)] overflow-y-auto p-3 lg:sticky lg:top-4">
                {panels}
              </aside>
            </div>
          )}
        </div>

        <PublishDialog
          open={dialog === "publish"}
          onOpenChange={(o) => !o && setDialog(null)}
          formName={form.name}
          nextVersion={nextNumber}
          baseLabel={baseLabel}
          diff={publishDiff}
          errors={errors}
          entryCount={props.entryCount}
          busy={publishing}
          error={publishError}
          onPublish={(note) => void doPublish(note)}
          onOpenRescore={props.onOpenRescore}
        />
        <HistoryDialog open={dialog === "history"} onOpenChange={(o) => !o && setDialog(null)} loadVersions={props.loadVersions} builtin={builtin} working={form} usage={props.usage} nameOf={props.nameOf} onRestore={doRestore} />
        <ShortcutsDialog open={dialog === "shortcuts"} onOpenChange={(o) => !o && setDialog(null)} />

        <Dialog open={dialog === "leave"} onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>The draft can&apos;t be saved right now{saveError ? `: ${saveError}` : errors[0] ? `: ${errors[0].message}` : ""}. If you leave, the changes since the last save are lost.</DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={onClose}>
                Leave and lose changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={dialog === "discard"} onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent>
            <DialogTitle>Discard your changes?</DialogTitle>
            <DialogDescription>
              Your unpublished changes are thrown away and the form goes back to {publishedNow ? `its live version (v${publishedNow.version})` : "the built-in"}. Published versions are not touched.
            </DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={() => void doDiscard()}>
                Discard changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </BuilderDnd>
    </BuilderContext.Provider>
  );
}

function SaveIndicator({ state, error, invalidMessage, onRetry }: { state: SaveState; error: string | null; invalidMessage?: string; onRetry: () => void }) {
  const base = "mt-0.5 flex flex-wrap items-center gap-1.5 text-xs";
  switch (state) {
    case "saving":
      return (
        <p className={cn(base, "text-[var(--muted-foreground)]")} role="status" data-testid="save-state" data-state="saving">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </p>
      );
    case "unsaved":
      return (
        <p className={cn(base, "text-amber-300")} role="status" data-testid="save-state" data-state="unsaved">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> Unsaved changes
        </p>
      );
    case "invalid":
      return (
        <p className={cn(base, "text-red-300")} role="status" data-testid="save-state" data-state="invalid">
          <AlertTriangle className="h-3 w-3" /> Not saved yet: {invalidMessage ?? "fix the problem shown in Problems"}
        </p>
      );
    case "error":
      return (
        <p className={cn(base, "text-red-300")} role="alert" data-testid="save-state" data-state="error">
          <AlertTriangle className="h-3 w-3" /> Couldn&apos;t save{error ? `: ${error}` : ""}.
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
        </p>
      );
    default:
      return (
        <p className={cn(base, "text-[var(--muted-foreground)]")} role="status" data-testid="save-state" data-state="saved">
          <Check className="h-3 w-3" /> Draft saved
        </p>
      );
  }
}

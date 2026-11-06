"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { RichText } from "@/components/ui/rich-text";
import { Switch } from "@/components/ui/switch";
import {
  CHANGE_TYPES,
  MAX_CHANGES,
  MAX_CHANGE_TEXT,
  MAX_SUMMARY,
  MAX_TITLE,
  MAX_VERSION,
  moveItem,
  validateDraft,
  type ChangeType,
  type ChangelogDraft,
  type DraftErrors,
} from "@/lib/changelog";
import { saveEntry, useAsyncAction } from "@/lib/changelog/store";
import { cn } from "@/lib/utils";

const MARKUP_HINT = "Supports **bold**, *italic*, and [links](https://example.com) — https links only.";
const hasMarkup = (text: string) => /[*_[]/.test(text);

const selectClass =
  "h-11 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-3 text-sm text-[var(--foreground)] outline-none transition-shadow duration-300 focus:border-transparent focus:shadow-[0_0_0_3px_rgba(var(--glow),0.25),0_0_24px_2px_rgba(var(--glow),0.2)] [&>option]:bg-[#1b1b26] [&>option]:text-white";

function FieldError({ id, children }: { id?: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-red-300">
      {children}
    </p>
  );
}

/**
 * The create/edit dialog for one changelog entry. Mount it with a fresh `key`
 * each time it's opened so the form starts from `initial` (see the page).
 */
export function EntryEditor({
  open,
  onOpenChange,
  entryId,
  initial,
  actor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = creating a new entry. */
  entryId: string | null;
  initial: ChangelogDraft;
  actor: { teamId: string; uid: string; name: string };
}) {
  const [draft, setDraft] = useState<ChangelogDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const { busy, error, run } = useAsyncAction();

  const set = <K extends keyof ChangelogDraft>(key: K, value: ChangelogDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setRow = (i: number, patch: Partial<{ type: ChangeType; text: string }>) => setDraft((d) => ({ ...d, changes: d.changes.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const moveRow = (i: number, delta: -1 | 1) => setDraft((d) => ({ ...d, changes: moveItem(d.changes, i, delta) }));
  const removeRow = (i: number) => setDraft((d) => ({ ...d, changes: d.changes.filter((_, j) => j !== i) }));
  const addRow = () => setDraft((d) => (d.changes.length >= MAX_CHANGES ? d : { ...d, changes: [...d.changes, { type: d.changes[d.changes.length - 1]?.type ?? "new", text: "" }] }));

  const handleSave = async () => {
    const result = validateDraft(draft);
    setErrors(result.errors);
    if (!result.ok) return;
    const saved = await run(() => saveEntry(actor, entryId, draft), "Couldn't save the entry. Check your connection and try again.");
    if (saved) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(94vw,700px)] overflow-y-auto">
        <DialogTitle className="pr-8">{entryId ? "Edit changelog entry" : "New changelog entry"}</DialogTitle>
        <DialogDescription>Drafts are only visible to admins until you publish them.</DialogDescription>

        <form
          className="mt-5 flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr]">
            <div>
              <Label htmlFor="cl-version">Version or label</Label>
              <Input id="cl-version" value={draft.version} maxLength={MAX_VERSION} placeholder="v1.4.0" onChange={(e) => set("version", e.target.value)} aria-invalid={!!errors.version} />
              <FieldError>{errors.version}</FieldError>
            </div>
            <div>
              <Label htmlFor="cl-date">Date</Label>
              <Input id="cl-date" type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!errors.date} />
              <FieldError>{errors.date}</FieldError>
            </div>
          </div>

          <div>
            <Label htmlFor="cl-title">Title</Label>
            <Input id="cl-title" value={draft.title} maxLength={MAX_TITLE} placeholder="What this release is about" onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title} />
            <FieldError>{errors.title}</FieldError>
          </div>

          <div>
            <Label htmlFor="cl-summary">Summary (optional)</Label>
            <Textarea id="cl-summary" rows={3} value={draft.summary} maxLength={MAX_SUMMARY} onChange={(e) => set("summary", e.target.value)} aria-describedby="cl-markup-hint" aria-invalid={!!errors.summary} />
            <p id="cl-markup-hint" className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              {MARKUP_HINT}
            </p>
            <FieldError>{errors.summary}</FieldError>
            {hasMarkup(draft.summary) && (
              <p className="mt-2 rounded-xl border border-[var(--glass-border)] bg-white/4 px-3 py-2 text-sm text-[var(--muted-foreground)]">
                <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide">Preview</span>
                <RichText text={draft.summary} />
              </p>
            )}
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Changes</legend>
            {draft.changes.map((change, i) => {
              const typeMeta = CHANGE_TYPES.find((t) => t.id === change.type);
              const rowError = errors.changeRows?.[i];
              return (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <select aria-label={`Change ${i + 1} type`} value={change.type} onChange={(e) => setRow(i, { type: e.target.value as ChangeType })} className={cn(selectClass, "w-[7.5rem] shrink-0")}>
                      {CHANGE_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <Input aria-label={`Change ${i + 1} text`} className="min-w-0 flex-1 basis-48" value={change.text} maxLength={MAX_CHANGE_TEXT} placeholder="Describe the change" onChange={(e) => setRow(i, { text: e.target.value })} aria-invalid={!!rowError} />
                    <div className="flex shrink-0 items-center">
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Move change ${i + 1} up`} disabled={i === 0} onClick={() => moveRow(i, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Move change ${i + 1} down`} disabled={i === draft.changes.length - 1} onClick={() => moveRow(i, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 hover:text-red-300" aria-label={`Remove change ${i + 1}`} disabled={draft.changes.length === 1} onClick={() => removeRow(i)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <FieldError>{rowError}</FieldError>
                  {hasMarkup(change.text) && !rowError && (
                    <p className="ml-1 flex items-start gap-2 text-sm text-[var(--muted-foreground)]">
                      <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", typeMeta?.bullet)} aria-hidden />
                      <RichText text={change.text} />
                    </p>
                  )}
                </div>
              );
            })}
            <FieldError>{errors.changes}</FieldError>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={draft.changes.length >= MAX_CHANGES}>
                <Plus className="h-3.5 w-3.5" /> Add change
              </Button>
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-4">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="block font-medium">Published</span>
                <span className="block text-xs text-[var(--muted-foreground)]">{draft.status === "published" ? "Everyone on the team can see this entry." : "Draft — only admins can see this entry."}</span>
              </span>
              <Switch checked={draft.status === "published"} onCheckedChange={(v) => set("status", v ? "published" : "draft")} aria-label="Published" />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="block font-medium">Pin to top</span>
                <span className="block text-xs text-[var(--muted-foreground)]">Pinned entries stay above newer ones.</span>
              </span>
              <Switch checked={draft.pinned} onCheckedChange={(v) => set("pinned", v)} aria-label="Pin to top" />
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : draft.status === "published" ? "Save and publish" : "Save draft"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

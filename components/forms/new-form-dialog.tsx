"use client";

import { useRef, useState } from "react";
import { Copy, FilePlus2, FileUp, LayoutTemplate, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { SelectRow, TextRow } from "@/components/forms/builder/controls";
import { ImportPreview } from "@/components/forms/import-preview";
import { duplicateAsNewForm, formFromImport, newFormFromScratch, type ImportedDraft } from "@/lib/forms/create";
import { FORM_LIMITS } from "@/lib/forms/validate";
import type { Form } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P22: "New form": start from scratch (the five default categories and the locked system fields), from a template (the P23 library: shown, disabled,
// until it exists), duplicate an existing form, or import a form file. Each produces an unpublished custom draft that the caller saves and opens.

type Mode = "scratch" | "duplicate" | "import";

export type NewFormChoice = { form: Form; how: "scratch" | "duplicate" | "import"; from?: string };

export function NewFormDialog({
  open,
  onOpenChange,
  existing,
  takenIds,
  createdBy,
  onCreate,
  onPickTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The forms that can be duplicated (what scouts see now, or the draft of one never published). */
  existing: { id: string; name: string; form: Form | null }[];
  takenIds: ReadonlySet<string>;
  createdBy: string;
  onCreate: (choice: NewFormChoice) => Promise<void>;
  /** Opens the template library ("From template"). Without it the tile is shown disabled. */
  onPickTemplate?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("scratch");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState<string | undefined>(existing.find((e) => e.form)?.id);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportedDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [repair, setRepair] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setText("");
    setErrors([]);
    setPreview(null);
    setRepair(false);
  };

  const submit = async () => {
    setErrors([]);
    const now = Date.now();
    let choice: NewFormChoice;
    if (mode === "scratch") {
      choice = { how: "scratch", form: newFormFromScratch({ name, description, taken: takenIds, createdBy, now }) };
    } else if (mode === "duplicate") {
      const src = existing.find((e) => e.id === sourceId)?.form;
      if (!src) return setErrors(["Pick a form to duplicate."]);
      choice = { how: "duplicate", from: src.id, form: duplicateAsNewForm(src, { name: name || `${src.name} (copy)`, taken: takenIds, createdBy, now }) };
    } else {
      // two steps: check the file and show what it would create, then create it
      const r = formFromImport(text, { name, taken: takenIds, createdBy, now }, { repairDuplicates: repair });
      if (!preview) return setPreview(r);
      if (!r.ok) return setPreview(r);
      choice = { how: "import", form: r.form };
    }
    setBusy(true);
    try {
      await onCreate(choice);
      reset();
      onOpenChange(false);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Couldn't create the form."]);
    } finally {
      setBusy(false);
    }
  };

  const tiles: { id: Mode | "template"; label: string; hint: string; icon: LucideIcon; disabled?: boolean }[] = [
    { id: "scratch", label: "Start from scratch", hint: "Pre-Match, Autonomous, Teleoperated, Endgame and Misc, with the locked system fields", icon: FilePlus2 },
    { id: "template", label: "From template", hint: onPickTemplate ? "Public templates and your own" : "The template library isn't available here", icon: LayoutTemplate, disabled: !onPickTemplate },
    { id: "duplicate", label: "Duplicate a form", hint: "A copy of one you already have", icon: Copy },
    { id: "import", label: "Import JSON", hint: "A form exported from here or another team", icon: FileUp },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="w-[min(94vw,600px)] max-h-[90vh] overflow-y-auto">
        <DialogTitle>New form</DialogTitle>
        <DialogDescription>It starts as a draft. Scouts don&apos;t see it until you publish it and make it the active form for a season.</DialogDescription>

        <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How to start">
          {tiles.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={mode === t.id}
              disabled={t.disabled}
              onClick={() => {
                if (t.id === "template") {
                  onOpenChange(false);
                  onPickTemplate?.();
                } else {
                  setMode(t.id);
                  setPreview(null);
                }
              }}
              className={cn("flex min-h-16 items-start gap-3 rounded-2xl border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50", mode === t.id ? "border-[var(--color-primary)] bg-white/[0.08]" : "border-[var(--glass-border)] bg-white/[0.03]")}
            >
              <t.icon className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block text-[11px] text-[var(--muted-foreground)]">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {mode === "duplicate" && (
            <SelectRow label="Duplicate which form?" value={sourceId} onChange={setSourceId} options={existing.filter((e) => e.form).map((e) => ({ value: e.id, label: e.name }))} />
          )}
          {mode === "import" && preview && (
            <ImportPreview
              result={preview}
              onBack={() => {
                setPreview(null);
                setRepair(false);
              }}
              onFix={() => {
                setRepair(true);
                setPreview(formFromImport(text, { name, taken: takenIds, createdBy, now: Date.now() }, { repairDuplicates: true }));
              }}
            />
          )}
          {mode === "import" && !preview && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > FORM_LIMITS.jsonBytes) return setErrors([`That file is too large (the limit is ${Math.round(FORM_LIMITS.jsonBytes / 1024)} KB).`]);
                    setText(await file.text());
                    setErrors([]);
                  }}
                />
                <Button variant="glass" size="sm" onClick={() => fileRef.current?.click()}>
                  Choose a .json file
                </Button>
                <span className="text-xs text-[var(--muted-foreground)]">or paste it below</span>
              </div>
              <Textarea aria-label="Form JSON" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "format": "compepicurus-form", … }' className="font-mono text-xs" />
            </div>
          )}
          <TextRow label={mode === "import" ? "Name (optional: the file's name is used if empty)" : "Name"} value={name} maxLength={FORM_LIMITS.name} onChange={setName} placeholder={mode === "duplicate" ? "Copy of the form" : "e.g. Pit scouting"} />
          {mode === "scratch" && <TextRow label="Description (optional)" multiline value={description} maxLength={FORM_LIMITS.description} onChange={setDescription} />}

          {errors.length > 0 && (
            <ul role="alert" className="list-disc rounded-2xl border border-red-400/40 bg-red-500/10 py-2 pl-7 pr-3 text-sm text-red-200">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy || (mode === "scratch" && !name.trim()) || (mode === "import" && (!text.trim() || (!!preview && !preview.ok)))}>
              {busy ? "Creating…" : mode === "import" ? (preview ? "Create form" : "Check file") : mode === "duplicate" ? "Duplicate" : "Create form"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

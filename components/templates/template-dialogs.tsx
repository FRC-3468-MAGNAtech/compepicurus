"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LivePreview } from "@/components/forms/builder/preview";
import { SelectRow, TextRow } from "@/components/forms/builder/controls";
import { TEMPLATE_LIMITS, cleanTags, type FormTemplate } from "@/lib/templates/build";
import type { Form } from "@/lib/forms/types";

// P23: the small dialogs of the template screens. Each is a controlled form around one action; the callers decide what the action does. `run` wraps the
// async work with a busy flag and shows an error from the server (a refusal always arrives as a readable sentence).

function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function Footer({ onCancel, busy, children }: { onCancel: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      {children}
    </div>
  );
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="mt-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {error}
    </p>
  ) : null;

/** A template, previewed as the real form with a test fill (nothing is saved). */
export function TemplatePreviewDialog({ template, onClose, footer }: { template: FormTemplate | null; onClose: () => void; footer?: React.ReactNode }) {
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(96vw,980px)] max-h-[92vh] overflow-y-auto">
        <DialogTitle>{template?.name}</DialogTitle>
        <DialogDescription>
          Preview of version {template?.version}: the real scout form with a test fill. Nothing you enter is saved.
        </DialogDescription>
        <div className="mt-3">{template && <LivePreview form={template.form} framed={false} />}</div>
        {footer && <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

/** Name, description and tags: for saving a form as a template, and for editing one's details. */
export function TemplateDetailsDialog({
  open,
  onClose,
  title,
  intro,
  confirmLabel,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: string;
  confirmLabel: string;
  initial: { name: string; description: string; tags: string[] };
  onSave: (v: { name: string; description: string; tags: string[] }) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,520px)] max-h-[90vh] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{intro}</DialogDescription>
        {open && <DetailsBody initial={initial} confirmLabel={confirmLabel} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function DetailsBody({ initial, confirmLabel, onClose, onSave }: { initial: { name: string; description: string; tags: string[] }; confirmLabel: string; onClose: () => void; onSave: (v: { name: string; description: string; tags: string[] }) => Promise<void> }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const { busy, error, run } = useRun(onClose);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <TextRow label="Name" value={name} maxLength={TEMPLATE_LIMITS.name} onChange={setName} />
      <TextRow label="Description" multiline value={description} maxLength={TEMPLATE_LIMITS.description} onChange={setDescription} hint="What it's for. Plain text: HTML is removed, and links must be https." />
      <TextRow label="Tags" value={tags} maxLength={200} onChange={setTags} hint="Comma-separated: a season or game (e.g. biobuzz), a purpose (pit, drive)…" />
      <ErrorLine error={error} />
      <Footer onCancel={onClose} busy={busy}>
        <Button disabled={busy || !name.trim()} onClick={() => void run(() => onSave({ name, description, tags: cleanTags(tags.split(",")) }))}>
          {busy ? "Saving…" : confirmLabel}
        </Button>
      </Footer>
    </div>
  );
}

/** "Use template": names the new form, then makes it. */
export function UseTemplateDialog({ template, onClose, onUse }: { template: FormTemplate | null; onClose: () => void; onUse: (t: FormTemplate, name: string) => Promise<void> }) {
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,480px)]">
        <DialogTitle>Use “{template?.name}”</DialogTitle>
        <DialogDescription>Makes a draft form in your account: a copy you can edit freely. Nothing changes for scouts until you publish it.</DialogDescription>
        {template && <UseBody template={template} onClose={onClose} onUse={onUse} />}
      </DialogContent>
    </Dialog>
  );
}

function UseBody({ template, onClose, onUse }: { template: FormTemplate; onClose: () => void; onUse: (t: FormTemplate, name: string) => Promise<void> }) {
  const [name, setName] = useState(template.name);
  const { busy, error, run } = useRun(onClose);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <TextRow label="Name of your form" value={name} maxLength={80} onChange={setName} />
      <p className="text-xs text-[var(--muted-foreground)]">
        {template.sectionCount} categories, {template.fieldCount} fields. Your copy remembers it came from this template (version {template.version}), so you&apos;ll be told when there&apos;s a newer one.
      </p>
      <ErrorLine error={error} />
      <Footer onCancel={onClose} busy={busy}>
        <Button disabled={busy || !name.trim()} onClick={() => void run(() => onUse(template, name))}>
          {busy ? "Creating…" : "Create draft form"}
        </Button>
      </Footer>
    </div>
  );
}

/** A reason is required (reject, take down, report). */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,480px)]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {open && <ReasonBody label={label} confirmLabel={confirmLabel} danger={danger} onClose={onClose} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  );
}

function ReasonBody({ label, confirmLabel, danger, onClose, onConfirm }: { label: string; confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useRun(onClose);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <TextRow label={label} multiline value={reason} maxLength={TEMPLATE_LIMITS.reason} onChange={setReason} />
      <ErrorLine error={error} />
      <Footer onCancel={onClose} busy={busy}>
        <Button variant={danger ? "danger" : "primary"} disabled={busy || reason.trim().length < 3} onClick={() => void run(() => onConfirm(reason))}>
          {busy ? "Sending…" : confirmLabel}
        </Button>
      </Footer>
    </div>
  );
}

/** A plain yes/no. */
export function ConfirmDialog({ open, onClose, title, description, confirmLabel, danger, onConfirm }: { open: boolean; onClose: () => void; title: string; description: React.ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,480px)]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {open && <ConfirmBody confirmLabel={confirmLabel} danger={danger} onClose={onClose} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({ confirmLabel, danger, onClose, onConfirm }: { confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const { busy, error, run } = useRun(onClose);
  return (
    <>
      <ErrorLine error={error} />
      <Footer onCancel={onClose} busy={busy}>
        <Button variant={danger ? "danger" : "primary"} disabled={busy} onClick={() => void run(onConfirm)}>
          {busy ? "Working…" : confirmLabel}
        </Button>
      </Footer>
    </>
  );
}

/** "Update from a form": pick which of your forms the template's new version is taken from. */
export function UpdateFromFormDialog({ template, forms, onClose, onUpdate }: { template: FormTemplate | null; forms: { id: string; name: string; form: Form | null }[]; onClose: () => void; onUpdate: (t: FormTemplate, form: Form) => Promise<void> }) {
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,520px)]">
        <DialogTitle>Update “{template?.name}” from a form</DialogTitle>
        <DialogDescription>
          {template?.visibility === "public"
            ? "This template is public, so the new version is sent for review. The version people can use now stays as it is until it's approved."
            : "Creates a new version of this private template from the form you pick."}
        </DialogDescription>
        {template && <UpdateBody template={template} forms={forms} onClose={onClose} onUpdate={onUpdate} />}
      </DialogContent>
    </Dialog>
  );
}

function UpdateBody({ template, forms, onClose, onUpdate }: { template: FormTemplate; forms: { id: string; name: string; form: Form | null }[]; onClose: () => void; onUpdate: (t: FormTemplate, form: Form) => Promise<void> }) {
  const options = forms.filter((f) => f.form);
  const [pick, setPick] = useState<string | undefined>(options[0]?.id);
  const { busy, error, run } = useRun(onClose);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <SelectRow label="Take the new version from" value={pick} onChange={setPick} options={options.map((o) => ({ value: o.id, label: o.name }))} />
      <ErrorLine error={error} />
      <Footer onCancel={onClose} busy={busy}>
        <Button
          disabled={busy || !pick}
          onClick={() => {
            const f = options.find((o) => o.id === pick)?.form;
            if (f) void run(() => onUpdate(template, f));
          }}
        >
          {busy ? "Sending…" : template.visibility === "public" ? "Send for review" : `Save as version ${template.version + 1}`}
        </Button>
      </Footer>
    </div>
  );
}

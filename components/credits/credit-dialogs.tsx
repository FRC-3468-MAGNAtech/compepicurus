"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_SECTION_TITLE,
  normalizeEntryFields,
  validateEntryFields,
  validateSectionTitle,
  type CreditEntry,
  type EntryErrors,
  type EntryFields,
} from "@/lib/credits/ops";

function FieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs text-red-300">
      {children}
    </p>
  );
}

/** Add or rename a section. Mount with a fresh `key` per open so the field starts from `initialTitle`. */
export function SectionDialog({
  open,
  onOpenChange,
  initialTitle,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = adding a new section. */
  initialTitle: string | null;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const problem = validateSectionTitle(title);
    setError(problem);
    if (problem) return;
    onSave(title.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="pr-8">{initialTitle === null ? "Add a section" : "Rename section"}</DialogTitle>
        <DialogDescription>Sections group related credits, like Team or Built with.</DialogDescription>
        <form
          className="mt-5 flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Label htmlFor="credit-section-title">Title</Label>
            <Input id="credit-section-title" autoFocus value={title} maxLength={MAX_SECTION_TITLE} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!error} />
            <FieldError>{error}</FieldError>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{initialTitle === null ? "Add section" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add or edit one credit. Mount with a fresh `key` per open. */
export function EntryDialog({
  open,
  onOpenChange,
  initial,
  sectionTitle,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = adding a new entry. */
  initial: CreditEntry | null;
  sectionTitle: string;
  onSave: (fields: EntryFields) => void;
}) {
  const [form, setForm] = useState({ name: initial?.name ?? "", description: initial?.description ?? "", link: initial?.link ?? "", imageUrl: initial?.imageUrl ?? "" });
  const [errors, setErrors] = useState<EntryErrors>({});
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    const fields = normalizeEntryFields(form);
    const result = validateEntryFields(fields);
    setErrors(result.errors);
    if (!result.ok) return;
    onSave(fields);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(94vw,560px)] overflow-y-auto">
        <DialogTitle className="pr-8">{initial ? "Edit credit" : "Add a credit"}</DialogTitle>
        <DialogDescription>In &ldquo;{sectionTitle}&rdquo;.</DialogDescription>
        <form
          className="mt-5 flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Label htmlFor="credit-name">Name</Label>
            <Input id="credit-name" autoFocus value={form.name} maxLength={MAX_NAME} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
            <FieldError>{errors.name}</FieldError>
          </div>
          <div>
            <Label htmlFor="credit-description">Role or description (optional)</Label>
            <Textarea id="credit-description" rows={3} value={form.description} maxLength={MAX_DESCRIPTION} onChange={(e) => set("description", e.target.value)} aria-describedby="credit-markup-hint" aria-invalid={!!errors.description} />
            <p id="credit-markup-hint" className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              Supports **bold**, *italic*, and [links](https://example.com) — https links only.
            </p>
            <FieldError>{errors.description}</FieldError>
          </div>
          <div>
            <Label htmlFor="credit-link">Link (optional)</Label>
            <Input id="credit-link" type="url" inputMode="url" placeholder="https://" value={form.link} onChange={(e) => set("link", e.target.value)} aria-invalid={!!errors.link} />
            <FieldError>{errors.link}</FieldError>
          </div>
          <div>
            <Label htmlFor="credit-image">Avatar or logo image link (optional)</Label>
            <Input id="credit-image" type="url" inputMode="url" placeholder="https://" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} aria-invalid={!!errors.imageUrl} />
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">Without one, the person&apos;s initials are shown.</p>
            <FieldError>{errors.imageUrl}</FieldError>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{initial ? "Save" : "Add credit"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Delete X?" confirmation that names what's being deleted. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  detail,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="pr-8">{title}</DialogTitle>
        <DialogDescription>{detail}</DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

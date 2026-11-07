"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/forms/builder/diff-view";
import { diffForms } from "@/lib/forms/diff";
import type { Form } from "@/lib/forms/types";
import type { FormTemplate } from "@/lib/templates/build";

// P23: "Update available". A form made from a public template remembers the template and its version. When the template has a newer version, this shows
// what the new version differs by from your form (so you can judge whether you want it), and offers to make a **new draft** from it. It never changes your
// form: updates are never applied automatically, and your own edits can't be overwritten.

export function UpdateAvailableDialog({ form, template, onClose, onCreate }: { form: Form | null; template: FormTemplate | null; onClose: () => void; onCreate: (t: FormTemplate) => Promise<void> }) {
  const open = !!form && !!template;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(96vw,720px)] max-h-[90vh] overflow-y-auto">
        <DialogTitle>Update available for “{form?.name}”</DialogTitle>
        <DialogDescription>
          {template && form ? `“${template.name}” is now at version ${template.version}; your form was made from version ${form.templateVersion ?? "?"}.` : ""} Below is what the new version differs by from your form. Nothing changes until you choose.
        </DialogDescription>
        {form && template && <Body form={form} template={template} onClose={onClose} onCreate={onCreate} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ form, template, onClose, onCreate }: { form: Form; template: FormTemplate; onClose: () => void; onCreate: (t: FormTemplate) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diff = diffForms(form, template.form);
  return (
    <div className="mt-4 flex flex-col gap-4">
      <DiffView diff={diff} emptyText="The new version is identical to your form: you already have these changes." />
      <p className="text-xs text-[var(--muted-foreground)]">This makes a new draft form from version {template.version}. Your current form, its versions and its entries are left exactly as they are, and any edits you made stay in it.</p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Not now
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onCreate(template);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't create the draft.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : `Create a draft from version ${template.version}`}
        </Button>
      </div>
    </div>
  );
}

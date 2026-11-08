"use client";

import { useEffect, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/credits/credit-dialogs";
import { Button } from "@/components/ui/button";

/**
 * FIX4: the admin's "Edit credits" / "Done" switch. Normal view is the default for everyone, admins included;
 * edit mode is only ever entered by pressing this, is never stored (a reload or leaving the page puts you back in
 * normal view), and Done asks first while a change is still being saved. Members get nothing at all (not even a
 * disabled button).
 */
export function CreditsEditToggle({ canEdit, editing, unsavedCount, onEdit, onDone }: { canEdit: boolean; editing: boolean; unsavedCount: number; onEdit: () => void; onDone: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Closing the tab while a change is still being written asks first (Done does too, below).
  useEffect(() => {
    if (!editing || unsavedCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, unsavedCount]);

  if (!canEdit) return null;

  return (
    <>
      {editing ? (
        <Button
          data-testid="credits-done"
          onClick={() => (unsavedCount > 0 ? setConfirmOpen(true) : onDone())}
          className="gap-2 self-start"
        >
          <Check className="h-4 w-4" /> Done
        </Button>
      ) : (
        <Button data-testid="credits-edit" variant="glass" onClick={onEdit} className="gap-2 self-start">
          <Pencil className="h-4 w-4" /> Edit credits
        </Button>
      )}
      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Leave edit mode?"
        detail={`${unsavedCount === 1 ? "A change is" : `${unsavedCount} changes are`} still being saved. If you leave now it may not finish.`}
        confirmLabel="Leave anyway"
        onConfirm={onDone}
      />
    </>
  );
}

"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// P22: the keyboard shortcuts cheat sheet (also opened with "?"). The handlers live in builder.tsx (`useBuilderShortcuts`); this list is the same one.

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Ctrl/⌘ + Z", what: "Undo" },
  { keys: "Ctrl/⌘ + Y  or  Ctrl/⌘ + Shift + Z", what: "Redo" },
  { keys: "Ctrl/⌘ + S", what: "Save the draft now" },
  { keys: "Ctrl/⌘ + D", what: "Duplicate the selected field" },
  { keys: "Alt + ↑ / Alt + ↓", what: "Move the selected field up / down" },
  { keys: "Delete", what: "Delete the selected field (undo brings it back)" },
  { keys: "Esc", what: "Deselect (form settings)" },
  { keys: "?", what: "Show this list" },
  { keys: "Tab, Enter, Space", what: "Everything has a button: move, duplicate and delete don't need dragging" },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,520px)]">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Undo, Redo and Save work everywhere in the builder, including in text boxes. The others are off while you&apos;re typing.</DialogDescription>
        <dl className="mt-4 flex flex-col gap-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-start justify-between gap-4 rounded-xl border border-[var(--glass-border)] px-3 py-2">
              <dt className="font-mono text-xs">{s.keys}</dt>
              <dd className="text-right text-[var(--muted-foreground)]">{s.what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

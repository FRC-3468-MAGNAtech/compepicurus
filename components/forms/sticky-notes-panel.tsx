"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pin, Plus, StickyNote as StickyNoteIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/lib/use-media-query";
import { readFraction, writeFraction } from "@/lib/workspace/layout";
import type { StickyNote } from "@/lib/forms/types";
import { MAX_NOTES, MAX_NOTE_LENGTH, NOTE_COLORS, PANEL_DEFAULT_PX, PANEL_MAX_PX, PANEL_MIN_PX, addNote, clampPanelWidth, deleteNote, editNote, formatNoteTime, newNote, noteColorClass, noteCount, setNoteColor, sortNotes, togglePin } from "@/lib/sticky-notes";
import { cn } from "@/lib/utils";

// P28: the sticky notes panel. A side panel that stays beside the form on desktop (sticky, collapsible, resizable; the width is remembered in this browser),
// and on a phone an edge tab that opens an expandable / collapsible bottom sheet. It never blocks the form (non-modal: no overlay, no focus trap). Notes are
// plain cards: add, type (saved into the form's state with every keystroke), pick a colour, pin to the top, delete. The parent owns the notes array.

const WIDTH_KEY = "sticky-notes-width";
const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** The note cards and the add button: what both the side panel and the sheet (and the practice workspace's comments drawer) show. */
export function StickyNotesList({
  notes,
  onChange,
  disabled,
  className,
  firstInputTestId,
  focusKey = 0,
}: {
  notes: StickyNote[];
  onChange: (notes: StickyNote[]) => void;
  disabled?: boolean;
  className?: string;
  /** The test id of the first (top) note's text box: the practice workspace's drawer keeps its old "comments-input". */
  firstInputTestId?: string;
  /** Bump to put the cursor in the first note (the drawer was opened on purpose); a list with no notes first starts an empty one. */
  focusKey?: number;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastFocusKey = useRef(0);
  useEffect(() => {
    if (focusKey === 0 || focusKey === lastFocusKey.current) return;
    lastFocusKey.current = focusKey;
    // no notes yet: start one; either way the cursor goes into the first text box once it is on screen
    if (notes.length === 0 && !disabled) onChange([newNote()]);
    requestAnimationFrame(() => requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const sorted = sortNotes(notes);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const add = () => {
    const note = newNote();
    onChange(addNote(notes, note));
    setFocusId(note.id);
  };

  return (
    <div ref={root} className={cn("flex flex-col gap-2", className)} data-testid="sticky-notes-list">
      <Button type="button" variant="glass" size="sm" className="gap-1.5 self-start" onClick={add} disabled={disabled || notes.length >= MAX_NOTES} data-testid="note-add">
        <Plus className="h-4 w-4" aria-hidden /> Add note
      </Button>
      {sorted.length === 0 && <p className="px-1 text-xs text-[var(--muted-foreground)]">No notes yet. Jot anything the form doesn&apos;t ask for.</p>}
      <ul className="flex flex-col gap-2">
        {sorted.map((n, index) => (
          <li key={n.id} data-testid="note-card" data-note-id={n.id} data-pinned={n.pinned ? "true" : undefined} className={cn("rounded-2xl border p-2", noteColorClass(n.color))}>
            <NoteTextarea note={n} testId={index === 0 ? firstInputTestId : undefined} autoFocus={focusId === n.id} disabled={disabled} onChange={(text) => onChange(editNote(notes, n.id, text))} />
            <div className="mt-1 flex items-center gap-1">
              <div role="radiogroup" aria-label="Note colour" className="flex items-center gap-1">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={n.color === c.id}
                    aria-label={c.label}
                    disabled={disabled}
                    onClick={() => onChange(setNoteColor(notes, n.id, c.id))}
                    className={cn("h-6 w-6 rounded-full border", noteColorClass(c.id), n.color === c.id && "ring-2 ring-[var(--color-primary)]")}
                  />
                ))}
              </div>
              <span className="ml-1 text-[10px] tabular-nums text-[var(--muted-foreground)]">{formatNoteTime(n.createdAt)}</span>
              <button type="button" aria-label={n.pinned ? "Unpin note" : "Pin note to the top"} aria-pressed={!!n.pinned} disabled={disabled} onClick={() => onChange(togglePin(notes, n.id))} className={cn("ml-auto flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10", n.pinned && "text-[var(--color-primary)]")}>
                <Pin className={cn("h-4 w-4", n.pinned && "fill-current")} />
              </button>
              {confirming === n.id ? (
                <button type="button" onClick={() => onChange(deleteNote(notes, n.id))} className="flex h-9 items-center rounded-full bg-red-500/20 px-3 text-xs font-semibold text-red-200" data-testid="note-delete-confirm">
                  Delete?
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Delete note"
                  disabled={disabled}
                  onClick={() => (n.text.trim() === "" ? onChange(deleteNote(notes, n.id)) : setConfirming(n.id))}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10 hover:text-red-300"
                  data-testid="note-delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteTextarea({ note, testId, autoFocus, disabled, onChange }: { note: StickyNote; testId?: string; autoFocus: boolean; disabled?: boolean; onChange: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // grow with the text
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [note.text]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      value={note.text}
      disabled={disabled}
      maxLength={MAX_NOTE_LENGTH}
      rows={2}
      aria-label="Note"
      data-testid={testId}
      placeholder="Write a note…"
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-xl bg-transparent p-1.5 text-sm outline-none placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
    />
  );
}

/** The tab (desktop strip or phone edge tab) with the notes icon and the count badge. */
function TabButton({ count, onClick, expanded, label, className, children }: { count: number; onClick: () => void; expanded: boolean; label: string; className?: string; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded} aria-label={`${label}${count > 0 ? `, ${count} note${count === 1 ? "" : "s"}` : ""}`} className={cn("glass-overlay flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]", className)} data-testid="notes-tab">
      <StickyNoteIcon className="h-4 w-4" aria-hidden />
      {children}
      {count > 0 && (
        <span className="rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary-foreground)]" data-testid="notes-badge">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The panel itself. Mount it as a sibling of the form (see `StickyNotesLayout`). `defaultOpen` is the form's setting; the open or closed state is the person's own after that.
 */
export function StickyNotesPanel({ notes, onChange, defaultOpen = false, disabled }: { notes: StickyNote[]; onChange: (notes: StickyNote[]) => void; defaultOpen?: boolean; disabled?: boolean }) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false); // the phone sheet: taller
  const [width, setWidth] = useState(() => clampPanelWidth((readFraction(storage(), WIDTH_KEY) ?? PANEL_DEFAULT_PX / 1000) * 1000));
  const count = noteCount(notes);

  const resize = (px: number) => {
    const next = clampPanelWidth(px);
    setWidth(next);
    writeFraction(storage(), WIDTH_KEY, next / 1000);
  };

  if (desktop) {
    if (!open) {
      return (
        <aside className="sticky top-4 hidden self-start lg:block" aria-label="Sticky notes" data-testid="notes-panel" data-state="collapsed">
          <TabButton count={count} onClick={() => setOpen(true)} expanded={false} label="Open sticky notes">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Notes
          </TabButton>
        </aside>
      );
    }
    return (
      <aside className="sticky top-4 flex max-h-[calc(100dvh-2rem)] shrink-0 self-start lg:flex" style={{ width }} aria-label="Sticky notes" data-testid="notes-panel" data-state="open">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the notes panel"
          aria-valuemin={PANEL_MIN_PX}
          aria-valuemax={PANEL_MAX_PX}
          aria-valuenow={width}
          tabIndex={0}
          data-testid="notes-resize"
          className="mr-1 w-2 shrink-0 cursor-col-resize touch-none rounded-full bg-white/10 outline-none hover:bg-[var(--color-primary)] focus-visible:bg-[var(--color-primary)]"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") resize(width + 16);
            else if (e.key === "ArrowRight") resize(width - 16);
            else if (e.key === "Home") resize(PANEL_MAX_PX);
            else if (e.key === "End") resize(PANEL_MIN_PX);
            else return;
            e.preventDefault();
          }}
          onDoubleClick={() => resize(PANEL_DEFAULT_PX)}
          onPointerDown={(e) => {
            const startX = e.clientX;
            const startW = width;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) => resize(startW + (startX - ev.clientX));
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
        <div className="glass-card flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <StickyNoteIcon className="h-4 w-4" aria-hidden /> Notes
              {count > 0 && <span className="rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary-foreground)]" data-testid="notes-badge">{count}</span>}
            </h2>
            <Button type="button" variant="ghost" size="icon" aria-label="Collapse sticky notes" onClick={() => setOpen(false)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StickyNotesList notes={notes} onChange={onChange} disabled={disabled} />
          </div>
        </div>
      </aside>
    );
  }

  // phone: an edge tab, and an expandable / collapsible bottom sheet (non-modal: nothing behind it is covered by an overlay or locked)
  return (
    <>
      {!open && (
        <div className="fixed bottom-24 right-0 z-30" data-testid="notes-panel" data-state="collapsed">
          <TabButton count={count} onClick={() => setOpen(true)} expanded={false} label="Open sticky notes" className="rounded-r-none">
            Notes
          </TabButton>
        </div>
      )}
      {open && (
        <aside
          aria-label="Sticky notes"
          data-testid="notes-panel"
          data-state={expanded ? "expanded" : "open"}
          className={cn("glass-overlay fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 rounded-t-3xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl", expanded ? "h-[85dvh]" : "h-[45dvh]")}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <StickyNoteIcon className="h-4 w-4" aria-hidden /> Notes
              {count > 0 && <span className="rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary-foreground)]" data-testid="notes-badge">{count}</span>}
            </h2>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label={expanded ? "Make the notes sheet smaller" : "Make the notes sheet taller"} onClick={() => setExpanded((v) => !v)} data-testid="notes-expand">
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} data-testid="notes-close">
                Close
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StickyNotesList notes={notes} onChange={onChange} disabled={disabled} />
          </div>
        </aside>
      )}
    </>
  );
}

/** The form with its notes panel beside it (desktop) or over it (phone). `enabled` is the form's `stickyNotes.enabled`; off, the children render alone. */
export function StickyNotesLayout({ enabled, defaultOpen, notes, onChange, disabled, children }: { enabled: boolean; defaultOpen?: boolean; notes: StickyNote[]; onChange: (notes: StickyNote[]) => void; disabled?: boolean; children: ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">{children}</div>
      <StickyNotesPanel notes={notes} onChange={onChange} defaultOpen={defaultOpen} disabled={disabled} />
    </div>
  );
}

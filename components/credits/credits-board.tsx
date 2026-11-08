"use client";

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDeleteDialog, EntryDialog, SectionDialog } from "@/components/credits/credit-dialogs";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/ui/rich-text";
import type { CreditEntry, CreditSection, CreditsOp, EntryFields } from "@/lib/credits/ops";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: a short press-and-hold on the grip starts a drag, so scrolling the page still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
}

const gripClass = "touch-none cursor-grab rounded-lg p-1.5 text-[var(--muted-foreground)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] active:cursor-grabbing";

type Dialogs =
  | { kind: "section"; key: number; sectionId: string | null; title: string | null }
  | { kind: "entry"; key: number; sectionId: string; entry: CreditEntry | null }
  | { kind: "delete-section"; section: CreditSection }
  | { kind: "delete-entry"; section: CreditSection; entry: CreditEntry };

/**
 * The credits sections. The normal view is the same for everyone, admins included. An admin gets the editing
 * controls (add / edit / reorder / delete) only while `editing` is on (FIX4: the page's explicit Edit credits
 * button; never the default). Every change — buttons, drag and drop, dialogs — is reported as a CreditsOp
 * (lib/credits/ops.ts) for the page to apply transactionally.
 */
export function CreditsBoard({ sections, admin: isAdmin, editing = false, onOp }: { sections: CreditSection[]; admin: boolean; editing?: boolean; onOp: (op: CreditsOp) => void }) {
  // Controls need both: the right (admin) and the explicit mode.
  const admin = isAdmin && editing;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [counter, setCounter] = useState(0);
  const sensors = useDragSensors();

  const show = (d: Dialogs) => {
    setCounter((c) => c + 1);
    setDialog(d);
    setDialogOpen(true);
  };
  const toggle = (id: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const onSectionsDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = sections.findIndex((s) => s.id === e.over!.id);
    if (to >= 0) onOp({ type: "move-section", sectionId: String(e.active.id), toIndex: to });
  };

  const sectionFor = (id: string | null) => sections.find((s) => s.id === id);

  return (
    <div className="flex flex-col gap-5">
      <DndContext id="credits-sections" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionsDragEnd}>
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy} disabled={!admin}>
          {sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              index={index}
              count={sections.length}
              admin={admin}
              open={!collapsed.has(section.id)}
              onToggle={() => toggle(section.id)}
              onOp={onOp}
              onRename={() => show({ kind: "section", key: counter + 1, sectionId: section.id, title: section.title })}
              onDelete={() => show({ kind: "delete-section", section })}
              onAddEntry={() => show({ kind: "entry", key: counter + 1, sectionId: section.id, entry: null })}
              onEditEntry={(entry) => show({ kind: "entry", key: counter + 1, sectionId: section.id, entry })}
              onDeleteEntry={(entry) => show({ kind: "delete-entry", section, entry })}
            />
          ))}
        </SortableContext>
      </DndContext>

      {admin && (
        <div>
          <Button variant="outline" onClick={() => show({ kind: "section", key: counter + 1, sectionId: null, title: null })}>
            <Plus className="h-4 w-4" /> Add section
          </Button>
        </div>
      )}

      {dialog?.kind === "section" && (
        <SectionDialog
          key={dialog.key}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialTitle={dialog.title}
          onSave={(title) => onOp(dialog.sectionId === null ? { type: "add-section", id: crypto.randomUUID(), title } : { type: "edit-section", sectionId: dialog.sectionId, title })}
        />
      )}
      {dialog?.kind === "entry" && (
        <EntryDialog
          key={dialog.key}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={dialog.entry}
          sectionTitle={sectionFor(dialog.sectionId)?.title ?? ""}
          onSave={(fields: EntryFields) => {
            const current = dialog.entry;
            onOp(current ? { type: "edit-entry", sectionId: dialog.sectionId, entryId: current.id, fields } : { type: "add-entry", sectionId: dialog.sectionId, entry: { id: crypto.randomUUID(), ...fields } });
          }}
        />
      )}
      {dialog?.kind === "delete-section" && (
        <ConfirmDeleteDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={`Delete “${dialog.section.title}”?`}
          detail={dialog.section.entries.length === 0 ? "This section is empty. It will be removed for everyone." : `This removes the section and its ${dialog.section.entries.length} ${dialog.section.entries.length === 1 ? "credit" : "credits"} for everyone. This can't be undone.`}
          confirmLabel="Delete section"
          onConfirm={() => onOp({ type: "delete-section", sectionId: dialog.section.id })}
        />
      )}
      {dialog?.kind === "delete-entry" && (
        <ConfirmDeleteDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={`Delete “${dialog.entry.name}”?`}
          detail={`This removes the credit from “${dialog.section.title}” for everyone. This can't be undone.`}
          confirmLabel="Delete credit"
          onConfirm={() => onOp({ type: "delete-entry", sectionId: dialog.section.id, entryId: dialog.entry.id })}
        />
      )}
    </div>
  );
}

function SectionCard({
  section,
  index,
  count,
  admin,
  open,
  onToggle,
  onOp,
  onRename,
  onDelete,
  onAddEntry,
  onEditEntry,
  onDeleteEntry,
}: {
  section: CreditSection;
  index: number;
  count: number;
  admin: boolean;
  open: boolean;
  onToggle: () => void;
  onOp: (op: CreditsOp) => void;
  onRename: () => void;
  onDelete: () => void;
  onAddEntry: () => void;
  onEditEntry: (entry: CreditEntry) => void;
  onDeleteEntry: (entry: CreditEntry) => void;
}) {
  const sensors = useDragSensors();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: !admin });
  const bodyId = `credits-section-${section.id}`;

  const onEntriesDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = section.entries.findIndex((en) => en.id === e.over!.id);
    if (to >= 0) onOp({ type: "move-entry", fromSectionId: section.id, entryId: String(e.active.id), toSectionId: section.id, toIndex: to });
  };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10 opacity-60")}>
      <section className="glass-card p-5" aria-label={section.title}>
        <div className="flex items-center gap-2">
          {admin && (
            <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag “${section.title}” to reorder`} className={gripClass}>
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]">
            <h2 className="truncate text-lg font-semibold">{section.title}</h2>
            <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-xs text-[var(--muted-foreground)]">{section.entries.length}</span>
            <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-300 group-hover:text-[var(--foreground)]", open && "rotate-180")} aria-hidden />
          </button>
          {admin && (
            <div className="flex shrink-0 items-center">
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move “${section.title}” up`} disabled={index === 0} onClick={() => onOp({ type: "move-section", sectionId: section.id, toIndex: index - 1 })}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move “${section.title}” down`} disabled={index === count - 1} onClick={() => onOp({ type: "move-section", sectionId: section.id, toIndex: index + 1 })}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Rename “${section.title}”`} onClick={onRename}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-300" aria-label={`Delete “${section.title}”`} onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div id={bodyId} key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
              <div className="pt-4">
                {section.entries.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">No credits in this section yet.</p>
                ) : (
                  <DndContext id={`credits-entries-${section.id}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEntriesDragEnd}>
                    <SortableContext items={section.entries.map((e) => e.id)} strategy={rectSortingStrategy} disabled={!admin}>
                      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {section.entries.map((entry, i) => (
                          <EntryTile key={entry.id} entry={entry} index={i} count={section.entries.length} sectionId={section.id} admin={admin} onOp={onOp} onEdit={() => onEditEntry(entry)} onDelete={() => onDeleteEntry(entry)} />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                )}
                {admin && (
                  <Button variant="outline" size="sm" className="mt-4" onClick={onAddEntry}>
                    <Plus className="h-3.5 w-3.5" /> Add credit
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function EntryTile({
  entry,
  index,
  count,
  sectionId,
  admin,
  onOp,
  onEdit,
  onDelete,
}: {
  entry: CreditEntry;
  index: number;
  count: number;
  sectionId: string;
  admin: boolean;
  onOp: (op: CreditsOp) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id, disabled: !admin });
  const [imageFailed, setImageFailed] = useState(false);
  const move = (toIndex: number): CreditsOp => ({ type: "move-entry", fromSectionId: sectionId, entryId: entry.id, toSectionId: sectionId, toIndex });

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("list-none", isDragging && "relative z-10 opacity-60")}>
      <motion.div whileHover={{ y: -2 }} transition={spring} className="glow-ring flex h-full flex-col rounded-2xl border border-[var(--glass-border)] bg-white/5 p-4">
        <div className="flex items-start gap-3">
          {entry.imageUrl && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin-supplied https URL on any host; next/image would need every host allow-listed
            <img src={entry.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-10 w-10 shrink-0 rounded-full bg-white/10 object-cover" />
          ) : (
            <Avatar name={entry.name} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-medium">
              {entry.link ? (
                <a href={entry.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 hover:text-[var(--color-accent)]">
                  <span className="break-words">{entry.name}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <span className="break-words">{entry.name}</span>
              )}
            </div>
            {entry.description && (
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                <RichText text={entry.description} />
              </p>
            )}
          </div>
        </div>

        {admin && (
          <div className="mt-3 flex items-center justify-end gap-0.5 border-t border-[var(--glass-border)] pt-2">
            <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag “${entry.name}” to reorder`} className={cn(gripClass, "mr-auto")}>
              <GripVertical className="h-4 w-4" />
            </button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move “${entry.name}” earlier`} disabled={index === 0} onClick={() => onOp(move(index - 1))}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move “${entry.name}” later`} disabled={index === count - 1} onClick={() => onOp(move(index + 1))}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit “${entry.name}”`} onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-300" aria-label={`Delete “${entry.name}”`} onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </motion.div>
    </li>
  );
}

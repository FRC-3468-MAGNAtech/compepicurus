"use client";

import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, ArrowRight, ChevronRight, GripVertical, X } from "lucide-react";
import { FieldIcon } from "@/components/scout/field-icons";
import { addStep, canAddStep, isMovable, moveStep, removeStep, summarizeSequence } from "@/lib/forms/sequence";
import type { SequenceStep } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P27: the step builder (the pit scout's auto cycle). Tap a step to append it; once-only steps can't be added twice; a step pinned first or last stays at
// its end; the middle steps drag (mouse, press-and-hold on touch, keyboard) or use the arrows; any step can be removed. Shown as numbered chips joined by
// arrows, with a one-line text summary underneath. All the rules are in lib/forms/sequence.ts.

type Item = { id: string; stepId: string; index: number };

function Chip({ item, step, movable, last, disabled, onMove, onRemove }: { item: Item; step: SequenceStep | undefined; movable: boolean; last: boolean; disabled?: boolean; onMove: (to: number) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !movable || disabled });
  const label = step?.label ?? item.stepId;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex items-center gap-1", isDragging && "relative z-10 opacity-70")} data-testid={`seq-chip-${item.index}`} data-step={item.stepId} data-pinned={step?.pin ?? undefined}>
      <div className={cn("glass-card flex items-center gap-1 rounded-2xl py-1 pl-1.5 pr-1", step?.pin && "ring-1 ring-[var(--color-primary)]")}>
        {movable && !disabled ? (
          <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag ${label} (step ${item.index + 1}) to reorder`} className="flex h-9 w-7 touch-none cursor-grab items-center justify-center rounded-lg text-[var(--muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]">
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-1.5" aria-hidden />
        )}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[var(--color-primary-foreground)]" style={{ background: "var(--theme-gradient)" }}>
          {item.index + 1}
        </span>
        {step?.icon && <FieldIcon name={step.icon} />}
        <span className="px-1 text-sm font-medium">{label}</span>
        {movable && !disabled && (
          <>
            <button type="button" onClick={() => onMove(item.index - 1)} aria-label={`Move ${label} (step ${item.index + 1}) earlier`} className="flex h-9 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onMove(item.index + 1)} aria-label={`Move ${label} (step ${item.index + 1}) later`} className="flex h-9 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
        {!disabled && (
          <button type="button" onClick={onRemove} aria-label={`Remove ${label} (step ${item.index + 1})`} className="flex h-9 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {!last && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />}
    </li>
  );
}

export function SequenceField({ label, steps, value, disabled, onChange }: { label: string; steps: SequenceStep[]; value: string[]; disabled?: boolean; onChange: (value: string[]) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const items: Item[] = value.map((stepId, index) => ({ id: `${index}:${stepId}`, stepId, index }));
  const byId = new Map(steps.map((s) => [s.id, s]));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.id === e.active.id);
    const to = items.findIndex((i) => i.id === e.over!.id);
    if (from >= 0 && to >= 0) onChange(moveStep(steps, value, from, to));
  };

  return (
    <div className="flex flex-col gap-3" data-testid="sequence-field">
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Add a step to ${label}`}>
        {steps.map((s) => {
          const can = canAddStep(steps, value, s.id);
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled || !can}
              onClick={() => onChange(addStep(steps, value, s.id))}
              data-testid={`seq-add-${s.id}`}
              className={cn("glass-card flex min-h-12 items-center gap-2 rounded-2xl border border-[var(--glass-border)] px-4 py-2 text-sm font-medium transition-colors", (disabled || !can) && "cursor-not-allowed opacity-45")}
            >
              {s.icon && <FieldIcon name={s.icon} />}
              {s.label}
              {s.maxCount === 1 && can === false && <span className="text-[10px] uppercase text-[var(--muted-foreground)]">added</span>}
            </button>
          );
        })}
      </div>

      {value.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">Tap the steps above in the order they happen.</p>
      ) : (
        <DndContext id={`seq-${label}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
            <ol className="flex flex-wrap items-center gap-y-2" aria-label={`${label}: the steps in order`}>
              {items.map((item) => (
                <Chip key={item.id} item={item} step={byId.get(item.stepId)} movable={isMovable(steps, value, item.index)} last={item.index === items.length - 1} disabled={disabled} onMove={(to) => onChange(moveStep(steps, value, item.index, to))} onRemove={() => onChange(removeStep(value, item.index))} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {value.length > 0 && (
        <p className="text-sm text-[var(--muted-foreground)]" data-testid="seq-summary">
          {summarizeSequence(steps, value)}
        </p>
      )}
    </div>
  );
}

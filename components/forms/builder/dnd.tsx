"use client";

import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { useBuilder } from "@/components/forms/builder/context";
import { addField, defaultField, findField, findSection, layoutOf, moveField } from "@/lib/forms/edit";
import type { Form, UserFieldType } from "@/lib/forms/types";

// P22: drag and drop for the builder, @dnd-kit. One DndContext wraps the palette and the canvas so a palette item can be dropped into a category or
// group as well as a field being moved between them. Every drag has a button equivalent (Add, Move up/down, in the canvas and inspector), so none
// of it is needed from a keyboard or a touchscreen.

export type DragData =
  | { type: "palette"; fieldType: UserFieldType }
  | { type: "field"; fieldId: string; sectionId: string; groupId?: string }
  | { type: "container"; sectionId: string; groupId?: string };

export const containerId = (sectionId: string, groupId?: string): string => (groupId ? `c:${sectionId}:${groupId}` : `c:${sectionId}`);

/** The position of a field within its on-screen container (ungrouped list or its group). */
function indexInContainer(form: Form, fieldId: string): number {
  const hit = findField(form, fieldId);
  if (!hit) return 0;
  const layout = layoutOf(hit.section);
  const list = hit.field.groupId ? layout.groups.find((g) => g.group.id === hit.field.groupId)?.fields : layout.ungrouped;
  return Math.max(0, (list ?? layout.ungrouped).findIndex((f) => f.id === fieldId));
}

export function BuilderDnd({ children }: { children: ReactNode }) {
  const { form, update, select, compact } = useBuilder();
  const [overlay, setOverlay] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as DragData | undefined;
    if (d?.type === "palette") setOverlay(d.fieldType);
    else if (d?.type === "field") setOverlay(findField(form, d.fieldId)?.field.label ?? "Field");
  };

  const onDragEnd = (e: DragEndEvent) => {
    setOverlay(null);
    const from = e.active.data.current as DragData | undefined;
    const over = e.over?.data.current as DragData | undefined;
    if (!from || !over || compact || from.type === "container") return;
    let target: { sectionId: string; groupId?: string; index: number };
    if (over.type === "field") target = { sectionId: over.sectionId, groupId: over.groupId, index: indexInContainer(form, over.fieldId) };
    else if (over.type === "container") target = { sectionId: over.sectionId, groupId: over.groupId, index: Number.MAX_SAFE_INTEGER };
    else return;
    if (!findSection(form, target.sectionId)) return;

    if (from.type === "palette") {
      let id: string | null = null;
      update((f) => {
        const field = defaultField(f, from.fieldType);
        id = field.id;
        return addField(f, target.sectionId, field, { index: target.index === Number.MAX_SAFE_INTEGER ? undefined : target.index, groupId: target.groupId });
      });
      if (id) select({ kind: "field", id });
    } else if (from.fieldId !== (over.type === "field" ? over.fieldId : null)) {
      update((f) => moveField(f, from.fieldId, target));
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setOverlay(null)}>
      {children}
      <DragOverlay dropAnimation={null}>
        {overlay ? (
          <div className="glass-strong flex items-center gap-2 rounded-2xl border border-[var(--glass-border)] px-3 py-2 text-sm font-medium shadow-2xl">
            <GripVertical className="h-4 w-4 text-[var(--muted-foreground)]" /> {overlay}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

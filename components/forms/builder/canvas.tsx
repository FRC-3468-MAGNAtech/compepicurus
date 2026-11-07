"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, EyeOff, GripVertical, Lock, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldIcon } from "@/components/scout/field-icons";
import { containerId, type DragData } from "@/components/forms/builder/dnd";
import { useBuilder } from "@/components/forms/builder/context";
import { addField, addSection, defaultField, duplicateField, FIELD_TYPE_LABEL, isSystemField, layoutOf, moveFieldBy, moveSectionBy, removeField } from "@/lib/forms/edit";
import { describeScoring } from "@/lib/forms/diff";
import { ACCENT_TOKENS } from "@/components/scout/field-icons";
import { phaseLabel, USER_FIELD_TYPES, type FormField, type FormSection, type UserFieldType } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P22: the canvas: categories as cards, fields as rows (with their key, type and points at a glance), optional groups inside. Rows are draggable
// (@dnd-kit) and also have move up/down, duplicate and delete buttons. On a phone the structure is read-only: rows just select.

export function Canvas() {
  const { form, update, select, selection, compact } = useBuilder();
  return (
    <div className="flex flex-col gap-3" data-testid="builder-canvas">
      {form.sections.map((s, i) => (
        <SectionCard key={s.id} section={s} index={i} count={form.sections.length} />
      ))}
      {!compact && (
        <Button
          variant="glass"
          className="gap-2 self-start"
          onClick={() => {
            let id: string | null = null;
            update((f) => {
              const r = addSection(f);
              id = r.id;
              return r.form;
            });
            if (id) select({ kind: "section", id });
          }}
        >
          <Plus className="h-4 w-4" /> Add category
        </Button>
      )}
      <button type="button" onClick={() => select({ kind: "form" })} className={cn("flex min-h-11 items-center gap-2 self-start rounded-full px-3 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]", selection.kind === "form" && "text-[var(--foreground)] underline")}>
        <Settings2 className="h-3.5 w-3.5" /> Form settings
      </button>
    </div>
  );
}

function AddFieldMenu({ sectionId, groupId, label = "Add field" }: { sectionId: string; groupId?: string; label?: string }) {
  const { update, select } = useBuilder();
  return (
    <Select
      value=""
      onValueChange={(t) => {
        let id: string | null = null;
        update((f) => {
          const field = defaultField(f, t as UserFieldType);
          id = field.id;
          return addField(f, sectionId, field, { groupId });
        });
        if (id) select({ kind: "field", id });
      }}
    >
      <SelectTrigger className="h-9 w-auto min-w-36 gap-2 rounded-full text-xs" aria-label={`${label} to ${groupId ? "group" : "category"}`}>
        <SelectValue
          placeholder={
            <span className="flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> {label}
            </span>
          }
        />
      </SelectTrigger>
      <SelectContent>
        {USER_FIELD_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {FIELD_TYPE_LABEL[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SectionCard({ section, index, count }: { section: FormSection; index: number; count: number }) {
  const { form, update, select, selection, compact, issues } = useBuilder();
  const layout = layoutOf(section);
  const selected = selection.kind === "section" && selection.id === section.id;
  const problems = issues.filter((i) => i.sectionId === section.id && !i.fieldId);
  const accent = section.accent && section.accent !== "default" ? ACCENT_TOKENS[section.accent] : undefined;
  const hasSystem = section.fields.some(isSystemField);

  return (
    <section
      aria-label={`Category ${section.title}`}
      className={cn("glass-card flex flex-col gap-2 p-3 transition-shadow", selected && "ring-2 ring-[var(--color-primary)]", !section.visible && "opacity-60")}
      style={accent ? { borderLeft: `4px solid ${accent}` } : undefined}
    >
      <header className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => select({ kind: "section", id: section.id })} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-1 text-left" aria-label={`Edit category ${section.title}`}>
          <span className="truncate text-sm font-semibold">{section.title}</span>
          <Badge variant="outline">{phaseLabel(form, section.phase)}</Badge>
          {!section.visible && (
            <Badge variant="warning" className="gap-1">
              <EyeOff className="h-3 w-3" /> Hidden
            </Badge>
          )}
          {problems.some((p) => p.severity === "error") && <span className="h-2 w-2 rounded-full bg-red-400" aria-label="Has errors" />}
        </button>
        {!compact && (
          <>
            <Button variant="ghost" size="icon" aria-label={`Move ${section.title} up`} disabled={index === 0} onClick={() => update((f) => moveSectionBy(f, section.id, -1))}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={`Move ${section.title} down`} disabled={index === count - 1} onClick={() => update((f) => moveSectionBy(f, section.id, 1))}>
              <ArrowDown className="h-4 w-4" />
            </Button>
          </>
        )}
      </header>

      <FieldList sectionId={section.id} fields={layout.ungrouped} emptyHint={hasSystem ? undefined : "No fields yet. Add one, or drag one here."} />
      {layout.groups.map(({ group, fields }) => (
        <div key={group.id} className="flex flex-col gap-1.5 rounded-xl border border-dashed border-[var(--glass-border)] p-2">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => select({ kind: "section", id: section.id })} className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {group.title}
            </button>
            {!compact && <AddFieldMenu sectionId={section.id} groupId={group.id} />}
          </div>
          <FieldList sectionId={section.id} groupId={group.id} fields={fields} emptyHint="Drag fields into this group." />
        </div>
      ))}
      {!compact && !hasSystem && (
        <div className="flex items-center gap-2 pt-1">
          <AddFieldMenu sectionId={section.id} />
        </div>
      )}
    </section>
  );
}

function FieldList({ sectionId, groupId, fields, emptyHint }: { sectionId: string; groupId?: string; fields: FormField[]; emptyHint?: string }) {
  const { compact } = useBuilder();
  const id = containerId(sectionId, groupId);
  const data: DragData = { type: "container", sectionId, groupId };
  const { setNodeRef, isOver } = useDroppable({ id, data, disabled: compact });
  return (
    <div ref={setNodeRef} className={cn("flex min-h-2 flex-col gap-1.5 rounded-xl transition-colors", isOver && "bg-[rgba(var(--glow),0.12)]")}>
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        {fields.map((f) => (
          <FieldRow key={f.id} field={f} sectionId={sectionId} groupId={groupId} />
        ))}
      </SortableContext>
      {fields.length === 0 && emptyHint && <p className="rounded-xl px-2 py-3 text-center text-xs text-[var(--muted-foreground)]">{emptyHint}</p>}
    </div>
  );
}

function pointsLabel(f: FormField): string | null {
  if (!f.scoring || f.scoring.mode === "none") return null;
  return describeScoring(f.scoring);
}

function FieldRow({ field, sectionId, groupId }: { field: FormField; sectionId: string; groupId?: string }) {
  const { update, select, selection, compact, issues } = useBuilder();
  const data: DragData = { type: "field", fieldId: field.id, sectionId, groupId };
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id, data, disabled: compact });
  const selected = selection.kind === "field" && selection.id === field.id;
  const system = isSystemField(field);
  const mine = issues.filter((i) => i.fieldId === field.id);
  const hasError = mine.some((i) => i.severity === "error");
  const points = pointsLabel(field);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-1 rounded-xl border bg-white/[0.04] pr-1 transition-colors", selected ? "border-[var(--color-primary)] bg-white/[0.08]" : "border-[var(--glass-border)]", isDragging && "opacity-40")}
      data-field-row={field.key}
    >
      {!compact && (
        <button type="button" {...attributes} {...listeners} aria-label={`Drag ${field.label}`} className="flex h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--muted-foreground)] active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={() => select({ kind: "field", id: field.id })} aria-pressed={selected} className={cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 py-1 text-left", compact && "pl-3")}>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <FieldIcon name={field.ui?.icon} />
          <span className="truncate">{field.label || <em className="text-red-300">Untitled</em>}</span>
          {system && <Lock className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" aria-label="Locked system field" />}
          {field.required && !system && <span className="text-red-300" aria-label="Required">*</span>}
          {field.visibleWhen && <Badge variant="outline">if…</Badge>}
          {hasError && <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" aria-label="Has errors" />}
          {!hasError && mine.length > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="Has tips" />}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted-foreground)]">
          <span>{FIELD_TYPE_LABEL[field.type]}</span>
          <span className="font-mono">{field.key}</span>
          {points && <span className="font-medium text-[var(--foreground)]">{points}</span>}
        </span>
      </button>
      {!compact && !system && (
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon" aria-label={`Move ${field.label} up`} onClick={() => update((f) => moveFieldBy(f, field.id, -1))}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Move ${field.label} down`} onClick={() => update((f) => moveFieldBy(f, field.id, 1))}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Duplicate ${field.label}`}
            onClick={() => {
              let id: string | null = null;
              update((f) => {
                const r = duplicateField(f, field.id);
                id = r.id;
                return r.form;
              });
              if (id) select({ kind: "field", id });
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${field.label}`}
            className="text-red-300"
            onClick={() => {
              update((f) => removeField(f, field.id));
              if (selected) select({ kind: "form" });
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
      {!compact && system && (
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon" aria-label={`Move ${field.label} up`} onClick={() => update((f) => moveFieldBy(f, field.id, -1))}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Move ${field.label} down`} onClick={() => update((f) => moveFieldBy(f, field.id, 1))}>
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBuilder } from "@/components/forms/builder/context";
import type { DragData } from "@/components/forms/builder/dnd";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { addField, addSystemField, defaultField, defaultTeamPicker, FIELD_TYPE_LABEL, missingSystemFields, findField, insertFromForm, isSystemField, type SourceRef } from "@/lib/forms/edit";
import { describeScoring } from "@/lib/forms/diff";
import { USER_FIELD_TYPES, type FormSection, type UserFieldType } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P22: the palette: the nine component types (click to add to the selected category, or drag onto the canvas), and "Insert from BIOBUZZ": clone any
// BIOBUZZ category, group or field, with its point values, into this form.

const TYPE_HINT: Record<UserFieldType, string> = {
  toggle: "On / off tile",
  counter: "+ / − tally",
  checkbox: "Small yes/no tile",
  number: "Type a number",
  text: "One line of text",
  textarea: "Comments box",
  select: "Dropdown list",
  radio: "Pick one (tiles)",
  rating: "Stars",
  slider: "Drag along a range",
  image: "Take or attach photos",
  sequence: "Ordered steps",
  matrix: "Grid of checkboxes",
};

/** Where a click-to-add goes: the selected category, the category of the selected field, else the first category after Pre-Match. */
export function useTargetSectionId(): string | null {
  const { form, selection } = useBuilder();
  if (selection.kind === "section") return selection.id;
  if (selection.kind === "field") return findField(form, selection.id)?.section.id ?? null;
  return form.sections.find((s) => s.phase !== "prematch")?.id ?? form.sections[0]?.id ?? null;
}

function PaletteItem({ type }: { type: UserFieldType }) {
  const { update, select, compact } = useBuilder();
  const target = useTargetSectionId();
  const data: DragData = { type: "palette", fieldType: type };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}`, data, disabled: compact });
  return (
    <div ref={setNodeRef} className={cn("flex items-center gap-1 rounded-xl border border-[var(--glass-border)] bg-white/[0.04] pr-1", isDragging && "opacity-40")}>
      <button type="button" {...attributes} {...listeners} aria-label={`Drag ${FIELD_TYPE_LABEL[type]} onto the canvas`} className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--muted-foreground)]">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1 py-1">
        <div className="text-sm font-medium">{FIELD_TYPE_LABEL[type]}</div>
        <div className="truncate text-[11px] text-[var(--muted-foreground)]">{TYPE_HINT[type]}</div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Add ${FIELD_TYPE_LABEL[type]}`}
        disabled={!target}
        onClick={() => {
          if (!target) return;
          let id: string | null = null;
          update((f) => {
            const field = defaultField(f, type);
            id = field.id;
            return addField(f, target, field);
          });
          if (id) select({ kind: "field", id });
        }}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function Palette() {
  const { update, select, form } = useBuilder();
  const target = useTargetSectionId();
  const [open, setOpen] = useState<string | null>(null);
  const sections = BIOBUZZ_FORM.sections.filter((s) => s.phase !== "prematch" && s.fields.some((f) => !isSystemField(f)));
  const targetTitle = form.sections.find((s) => s.id === target)?.title;

  const insert = (ref: SourceRef) => {
    let id: string | null = null;
    update((f) => {
      const r = insertFromForm(f, BIOBUZZ_FORM, ref, target ?? undefined);
      id = r.id;
      return r.form;
    });
    if (id) select(ref.kind === "section" ? { kind: "section", id } : ref.kind === "field" ? { kind: "field", id } : { kind: "section", id: target! });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="builder-palette">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Components</h3>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Click + to add to {targetTitle ? <strong className="text-[var(--foreground)]">{targetTitle}</strong> : "a category"}, or drag onto the canvas.
        </p>
        {USER_FIELD_TYPES.map((t) => (
          <PaletteItem key={t} type={t} />
        ))}
      </section>

      <PickerSection target={target} />

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Insert from BIOBUZZ</h3>
        <p className="text-[11px] text-[var(--muted-foreground)]">Copies a category, group or field with its point values. Groups and fields go into the selected category.</p>
        {sections.map((s) => (
          <BiobuzzSection key={s.id} section={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} insert={insert} canTarget={!!target} />
        ))}
      </section>
    </div>
  );
}

/** P27: the pickers a form can carry (event, match, alliance, team, scout: locked once placed) and the team picker for inside a per-team group. */
function PickerSection({ target }: { target: string | null }) {
  const { form, update, select } = useBuilder();
  const missing = missingSystemFields(form);
  const section = form.sections.find((s) => s.id === target);
  const repeatGroup = section?.groups?.find((g) => g.repeat);
  return (
    <section className="flex flex-col gap-1.5" data-testid="palette-pickers">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Pickers</h3>
      <p className="text-[11px] text-[var(--muted-foreground)]">Locked once placed: they can move within Pre-Match but not be deleted.</p>
      {missing.map((f) => (
        <div key={f.type} className="flex items-center gap-1 rounded-xl border border-[var(--glass-border)] bg-white/[0.04] pl-3 pr-1">
          <div className="min-w-0 flex-1 py-1.5 text-sm font-medium">{FIELD_TYPE_LABEL[f.type]}</div>
          <Button variant="ghost" size="icon" aria-label={`Add ${FIELD_TYPE_LABEL[f.type]}`} onClick={() => update((x) => addSystemField(x, f.type as never))}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {missing.length === 0 && <p className="text-[11px] text-[var(--muted-foreground)]">This form has every picker.</p>}
      <div className="flex items-center gap-1 rounded-xl border border-[var(--glass-border)] bg-white/[0.04] pl-3 pr-1">
        <div className="min-w-0 flex-1 py-1.5">
          <div className="text-sm font-medium">Team picker (per-team box)</div>
          <div className="truncate text-[11px] text-[var(--muted-foreground)]">{repeatGroup ? `Goes in "${repeatGroup.title}"` : "Needs a per-team group in the selected category"}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Add team picker to the per-team group"
          disabled={!target || !repeatGroup}
          onClick={() => {
            if (!target || !repeatGroup) return;
            let id: string | null = null;
            update((f) => {
              const field = defaultTeamPicker(f);
              id = field.id;
              return addField(f, target, field, { groupId: repeatGroup.id });
            });
            if (id) select({ kind: "field", id });
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function BiobuzzSection({ section, open, onToggle, insert, canTarget }: { section: FormSection; open: boolean; onToggle: () => void; insert: (r: SourceRef) => void; canTarget: boolean }) {
  const groups = section.groups ?? [];
  const ungrouped = section.fields.filter((f) => !f.groupId);
  return (
    <div className="rounded-xl border border-[var(--glass-border)] bg-white/[0.03]">
      <div className="flex items-center">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 flex-1 items-center gap-2 px-3 text-left text-sm font-medium">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
          {section.title}
          <span className="text-[11px] text-[var(--muted-foreground)]">{section.fields.length} fields</span>
        </button>
        <Button variant="glass" size="sm" className="mr-1.5" aria-label={`Insert category ${section.title}`} onClick={() => insert({ kind: "section", sectionId: section.id })}>
          Add all
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 border-t border-[var(--glass-border)] p-2">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{g.title}</span>
                <Button variant="ghost" size="sm" disabled={!canTarget} aria-label={`Insert group ${g.title}`} onClick={() => insert({ kind: "group", sectionId: section.id, groupId: g.id })}>
                  Add group
                </Button>
              </div>
              {section.fields.filter((f) => f.groupId === g.id).map((f) => (
                <BiobuzzField key={f.id} field={f} canTarget={canTarget} onAdd={() => insert({ kind: "field", fieldId: f.id })} />
              ))}
            </div>
          ))}
          {ungrouped.map((f) => (
            <BiobuzzField key={f.id} field={f} canTarget={canTarget} onAdd={() => insert({ kind: "field", fieldId: f.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

function BiobuzzField({ field, onAdd, canTarget }: { field: FormSection["fields"][number]; onAdd: () => void; canTarget: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{field.label}</div>
        <div className="truncate text-[11px] text-[var(--muted-foreground)]">
          {FIELD_TYPE_LABEL[field.type]}
          {field.scoring && field.scoring.mode !== "none" ? ` · ${describeScoring(field.scoring)}` : ""}
        </div>
      </div>
      <Button variant="ghost" size="icon" disabled={!canTarget} aria-label={`Insert ${field.label}`} onClick={onAdd}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

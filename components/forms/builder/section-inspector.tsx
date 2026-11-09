"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { GroupRepeatControls } from "@/components/forms/builder/p27-form-settings";
import { Group, SelectRow, SwitchRow, TextRow } from "@/components/forms/builder/controls";
import { useBuilder } from "@/components/forms/builder/context";
import { addGroup, duplicateSection, findSection, isSystemField, moveGroupBy, moveSectionBy, phaseKeyFromName, removeGroup, removeSection, setPhaseLabel, updateGroup, updateSection } from "@/lib/forms/edit";
import { FORM_LIMITS } from "@/lib/forms/validate";
import { PHASE_LABELS, phaseLabel, STANDARD_PHASES, type FieldUi } from "@/lib/forms/types";

const ACCENTS = (["primary", "secondary", "accent", "success", "warning", "danger"] as const).map((c) => ({ value: c as NonNullable<FieldUi["color"]>, label: c[0].toUpperCase() + c.slice(1) }));

export function SectionInspector({ sectionId }: { sectionId: string }) {
  const { form, update, select, compact, issues } = useBuilder();
  const section = findSection(form, sectionId);
  const [newPhase, setNewPhase] = useState("");
  if (!section) return <p className="text-sm text-[var(--muted-foreground)]">That category no longer exists.</p>;
  const hasSystem = section.fields.some(isSystemField);
  const index = form.sections.findIndex((s) => s.id === sectionId);
  const customPhases = [...new Set(form.sections.map((s) => s.phase).filter((p) => !(STANDARD_PHASES as readonly string[]).includes(p)))];
  const phaseOptions = [...STANDARD_PHASES.map((p) => ({ value: p as string, label: PHASE_LABELS[p] })), ...customPhases.map((p) => ({ value: p, label: phaseLabel(form, p) }))];
  const mine = issues.filter((i) => i.sectionId === sectionId && !i.fieldId);
  const patch = (p: Parameters<typeof updateSection>[2], key?: string) => update((f) => updateSection(f, sectionId, p), key ?? `s:${sectionId}`);
  const isCustom = !(STANDARD_PHASES as readonly string[]).includes(section.phase);

  return (
    <div className="flex flex-col gap-3" data-testid="section-inspector">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="glass">Category</Badge>
        <Badge variant="outline">{phaseLabel(form, section.phase)}</Badge>
        {!compact && (
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Move category up" disabled={index === 0} onClick={() => update((f) => moveSectionBy(f, sectionId, -1))}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Move category down" disabled={index === form.sections.length - 1} onClick={() => update((f) => moveSectionBy(f, sectionId, 1))}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Duplicate category"
              onClick={() => {
                let id: string | null = null;
                update((f) => {
                  const r = duplicateSection(f, sectionId);
                  id = r.id;
                  return r.form;
                });
                if (id) select({ kind: "section", id });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete category"
              className="text-red-300"
              disabled={hasSystem}
              title={hasSystem ? "This category holds the locked system fields" : "Delete category"}
              onClick={() => {
                update((f) => removeSection(f, sectionId));
                select({ kind: "form" });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {mine.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl border border-[var(--glass-border)] p-2 text-xs">
          {mine.map((i, n) => (
            <li key={n} className={i.severity === "error" ? "text-red-300" : "text-amber-300"}>
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <Group title="Basics">
        <TextRow label="Title" value={section.title} maxLength={FORM_LIMITS.label} invalid={!section.title.trim()} onChange={(v) => patch({ title: v }, `st:${sectionId}`)} />
        <SelectRow
          label="Phase"
          value={section.phase}
          disabled={hasSystem}
          onChange={(v) => v && patch({ phase: v })}
          options={phaseOptions}
          hint={hasSystem ? "The system fields keep this category in Pre-Match." : "Points from fields in this category roll into this phase's subtotal."}
        />
        {isCustom && <TextRow label="Phase name (shown in scores and analytics)" value={phaseLabel(form, section.phase)} onChange={(v) => update((f) => setPhaseLabel(f, section.phase, v), `pl:${section.phase}`)} />}
        {!hasSystem && !compact && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">New custom phase</span>
            <div className="flex gap-1.5">
              <Input aria-label="New custom phase name" placeholder="e.g. Pit stop" value={newPhase} maxLength={FORM_LIMITS.label} onChange={(e) => setNewPhase(e.target.value)} />
              <Button
                variant="glass"
                size="md"
                disabled={!newPhase.trim()}
                onClick={() => {
                  update((f) => {
                    const key = phaseKeyFromName(f, newPhase);
                    return setPhaseLabel(updateSection(f, sectionId, { phase: key }), key, newPhase);
                  });
                  setNewPhase("");
                }}
              >
                Use
              </Button>
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)]">Custom phases count in the total score and get their own column.</p>
          </div>
        )}
        <SwitchRow label="Shown to scouts" hint="A hidden category isn't scored, required or counted." checked={section.visible} disabled={hasSystem} onChange={(v) => patch({ visible: v })} />
        <SelectRow label="Accent colour" value={section.accent} allowNone noneLabel="None" onChange={(v) => patch({ accent: v })} options={ACCENTS} hint="A left rule in a theme colour." />
      </Group>

      <Group title="Groups (sub-headings)" defaultOpen={(section.groups?.length ?? 0) > 0}>
        {(section.groups ?? []).map((g, i, all) => (
          <div key={g.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Input aria-label={`Group ${i + 1} title`} value={g.title} maxLength={FORM_LIMITS.label} onChange={(e) => update((f) => updateGroup(f, sectionId, g.id, e.target.value), `g:${g.id}`)} />
            {!compact && (
              <>
                <Button variant="ghost" size="icon" aria-label={`Move group ${g.title} up`} disabled={i === 0} onClick={() => update((f) => moveGroupBy(f, sectionId, g.id, -1))}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Move group ${g.title} down`} disabled={i === all.length - 1} onClick={() => update((f) => moveGroupBy(f, sectionId, g.id, 1))}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Delete group ${g.title}`} onClick={() => update((f) => removeGroup(f, sectionId, g.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          {!compact && <GroupRepeatControls sectionId={sectionId} group={g} />}
          </div>
        ))}
        {!compact && (
          <Button variant="glass" size="sm" className="gap-1.5 self-start" disabled={(section.groups?.length ?? 0) >= FORM_LIMITS.groupsPerSection} onClick={() => update((f) => addGroup(f, sectionId).form)}>
            <Plus className="h-4 w-4" /> Add group
          </Button>
        )}
        <p className="text-[11px] text-[var(--muted-foreground)]">Deleting a group keeps its fields in the category. Drag fields into a group on the canvas.</p>
      </Group>
    </div>
  );
}

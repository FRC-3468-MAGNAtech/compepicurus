"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Group, SwitchRow, TextRow } from "@/components/forms/builder/controls";
import { useBuilder } from "@/components/forms/builder/context";
import { CompareSettings, FormTypeSettings, StickyNotesSettings } from "@/components/forms/builder/p27-form-settings";
import { FORM_LIMITS } from "@/lib/forms/validate";

// P22: the form-level settings (shown when nothing is selected): name, description, tags, whether the form scores at all, and the key aliases
// that keep old entries readable after a rename.

export function FormInspector() {
  const { form, update, entryCount, compact } = useBuilder();
  // What's typed in the tags box until the list it makes is what the form has (an undo then shows the form's own list again).
  const canonical = form.tags.join(", ");
  const [draft, setDraft] = useState<{ forTags: string; value: string } | null>(null);
  const tags = draft && draft.forTags === form.tags.join(",") ? draft.value : canonical;
  const aliases = Object.entries(form.keyAliases ?? {});

  return (
    <div className="flex flex-col gap-3" data-testid="form-inspector">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="glass">Form settings</Badge>
        {entryCount > 0 && <Badge variant="outline">{entryCount} entries</Badge>}
      </div>

      <Group title="About this form">
        <TextRow label="Name" value={form.name} maxLength={FORM_LIMITS.name} invalid={!form.name.trim()} onChange={(v) => update((f) => ({ ...f, name: v }), "form:name")} />
        <TextRow label="Description" multiline value={form.description} maxLength={FORM_LIMITS.description} onChange={(v) => update((f) => ({ ...f, description: v }), "form:description")} hint="Shown in the Forms list." />
        <TextRow
          label="Tags"
          value={tags}
          maxLength={200}
          onChange={(v) => {
            const list = [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, FORM_LIMITS.tags).map((t) => t.slice(0, 30));
            setDraft({ forTags: list.join(","), value: v });
            update((f) => ({ ...f, tags: list }), "form:tags");
          }}
          hint={`Comma-separated, up to ${FORM_LIMITS.tags}. Tag a form with a season id (e.g. biobuzz) and its entries count in that season's analytics.`}
        />
      </Group>

      <FormTypeSettings />

      <Group title="Scoring">
        <SwitchRow
          label="This form scores"
          hint="Off for pit scouting or driver feedback: entries get no score and accuracy shows n/a, and the score bar, score columns and score-based flags are hidden."
          checked={form.scoringEnabled}
          onChange={(v) => update((f) => ({ ...f, scoringEnabled: v }))}
        />
      </Group>

      <StickyNotesSettings />
      <CompareSettings />

      <Group title="Old key names (aliases)" defaultOpen={aliases.length > 0} badge={aliases.length > 0 ? <Badge variant="outline">{aliases.length}</Badge> : undefined}>
        {aliases.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">None. When you rename the data key of a field that was already published, an alias is added here so entries stored under the old key still read under the new one.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {aliases.map(([from, to]) => (
              <li key={from} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5 text-xs">
                <span className="font-mono">
                  {from} → {to}
                </span>
                {!compact && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove alias ${from}`}
                    onClick={() =>
                      update((f) => {
                        const next = { ...(f.keyAliases ?? {}) };
                        delete next[from];
                        const out = { ...f };
                        if (Object.keys(next).length > 0) out.keyAliases = next;
                        else delete out.keyAliases;
                        return out;
                      })
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {aliases.length > 0 && <p className="text-[11px] text-[var(--muted-foreground)]">Removing an alias means entries stored under the old key stop reading under the new one.</p>}
      </Group>
    </div>
  );
}

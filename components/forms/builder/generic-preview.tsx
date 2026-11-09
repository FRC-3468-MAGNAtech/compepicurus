"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { FormRenderer, type FormEntryState } from "@/components/forms/form-renderer";
import { Button } from "@/components/ui/button";
import { maxRepeatSlots } from "@/lib/forms/repeat";
import { defaultValues, validateValues } from "@/lib/forms/values";
import type { Form, FormValues } from "@/lib/forms/types";
import type { FtcEvent } from "@/lib/ftc/types";

// P27: the Form Builder's preview for the team's non-match forms: the real <FormRenderer /> on sample data (two events, a few teams, an alliance of 2 or 3
// teams), a test fill that is never saved. The match picker is a stand-in: the live form uses the real one.

const EVENTS: FtcEvent[] = [
  { code: "SAMPLE1", season: 2025, name: "Sample Qualifier", dateStart: "2025-11-08", dateEnd: "2025-11-08", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "in-progress" },
  { code: "SAMPLE2", season: 2025, name: "Sample League Meet", dateStart: "2025-12-06", dateEnd: "2025-12-06", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "upcoming" },
];
const TEAMS = [111, 222, 333, 444, 555, 666].map((n) => ({ teamNumber: n, name: `Sample team ${n}` }));

export type GenericPreviewHandle = { validate: () => boolean };

export const GenericPreview = forwardRef<GenericPreviewHandle, { form: Form; initialValues?: FormValues; onValues?: (v: FormValues) => void }>(function GenericPreview({ form, initialValues, onValues }, ref) {
  const [values, setValues] = useState<FormValues>(() => ({ ...defaultValues(form), ...initialValues }));
  const [entry, setEntry] = useState<FormEntryState>({ eventCode: "SAMPLE1", matchKey: "Q1", alliance: "red", teamNumber: null, scoutName: "Preview", });
  const [size, setSize] = useState<2 | 3>(2);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const allianceTeams = useMemo(() => TEAMS.slice(0, size).map((t) => t.teamNumber), [size]);
  const hasRepeat = maxRepeatSlots(form) > 0;

  useImperativeHandle(
    ref,
    () => ({
      validate: () => {
        const problems = validateValues(form, values, { slotCount: hasRepeat ? size : undefined });
        setErrors(problems);
        return Object.keys(problems).length === 0;
      },
    }),
    [form, values, hasRepeat, size]
  );

  return (
    <div className="flex flex-col gap-3" data-testid="generic-preview">
      {hasRepeat && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
          Alliance in the preview:
          {([2, 3] as const).map((n) => (
            <Button key={n} type="button" size="sm" variant={size === n ? "primary" : "glass"} aria-pressed={size === n} onClick={() => setSize(n)} data-testid={`preview-alliance-${n}`}>
              {n} teams
            </Button>
          ))}
        </div>
      )}
      <FormRenderer
        form={form}
        values={values}
        onValuesChange={(v) => {
          setValues(v);
          onValues?.(v);
        }}
        entry={entry}
        onEntryChange={(patch) => setEntry((e) => ({ ...e, ...patch }))}
        events={EVENTS}
        teams={TEAMS}
        allianceTeams={entry.alliance ? allianceTeams : []}
        errors={errors}
        renderMatchPicker={(field) => (
          <div>
            <p className="text-sm font-medium">{field.label}</p>
            <p className="glass-card mt-1.5 px-4 py-3 text-sm text-[var(--muted-foreground)]">The match picker (practice, qualification and finals) appears here in the live form. The preview uses Qualification 1.</p>
          </div>
        )}
      />
    </div>
  );
});

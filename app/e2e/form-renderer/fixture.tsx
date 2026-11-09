"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormRenderer, type FormEntryState } from "@/components/forms/form-renderer";
import { PhotoUploadProvider } from "@/components/forms/photo-upload";
import type { PlanCandidate } from "@/lib/forms/compare";
import { addField, addGroup, defaultField, defaultTeamPicker, setFormCompareWith, setGroupRepeat } from "@/lib/forms/edit";
import { createBlankForm } from "@/lib/forms/new-form";
import { defaultValues, validateValues } from "@/lib/forms/values";
import type { Form, FormValues, SequenceStep } from "@/lib/forms/types";
import type { FtcEvent } from "@/lib/ftc/types";

declare global {
  interface Window {
    __fr?: { values: FormValues; entry: FormEntryState; plan: { differences: number; linkedEntryId: string | null } | null; pending: Record<string, string[]>; errors: Record<string, string> };
  }
}

const STEPS: SequenceStep[] = [
  { id: "start", label: "Start", maxCount: 1, pin: "first" },
  { id: "hive", label: "Hive", maxCount: 0, pin: null },
  { id: "flower", label: "Flower", maxCount: 0, pin: null },
  { id: "bonus", label: "Bonus", maxCount: 1, pin: null },
  { id: "park", label: "Park", maxCount: 1, pin: "last" },
];

function buildForm(): Form {
  // seeded, so the ids are the same on the server and in the browser (random ids would be a hydration mismatch)
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let f = createBlankForm({ id: "drive-reflection-v1", name: "Reflection", createdBy: "u", formType: "drive-reflection" });
  const add = (type: Parameters<typeof defaultField>[1], label: string, patch: object = {}) => {
    f = addField(f, "misc", { ...defaultField(f, type, label, rand), ...patch });
  };
  add("slider", "Alliance skill", { key: "skill", min: 1, max: 5, ticks: true, endLabels: { min: "Weak", max: "Strong" } });
  add("sequence", "Auto cycle", { key: "cycle", steps: STEPS });
  add("matrix", "Moves", { key: "moves", rows: [{ key: "leave", label: "Leave" }, { key: "park", label: "Park" }], cols: [{ key: "auto", label: "Auto" }, { key: "end", label: "Endgame" }], disabledCells: ["leave_end"] });
  add("image", "Robot photos", { key: "photos", maxCount: 2, capture: true });
  const g = addGroup(f, "misc", "Teams", rand);
  f = setGroupRepeat(g.form, "misc", g.id!, { source: "allianceTeams", maxSlots: 3 });
  f = addField(f, "misc", defaultTeamPicker(f, "Team", rand), { groupId: g.id! });
  f = addField(f, "misc", { ...defaultField(f, "select", "Role", rand), key: "role", options: [{ value: "hive", label: "Hive" }, { value: "flower", label: "Flower" }] }, { groupId: g.id! });
  f = addField(f, "misc", { ...defaultField(f, "checkbox", "Scores in auto", rand), key: "auto" }, { groupId: g.id! });
  f = addField(f, "misc", { ...defaultField(f, "textarea", "Notes", rand), key: "notes", required: true }, { groupId: g.id! });
  return setFormCompareWith(f, { formId: "match-strategy-v1", matchOn: ["eventCode", "matchKey", "alliance"], fieldMap: { role: "role", auto: "auto" } });
}

const EVENTS: FtcEvent[] = [{ code: "EVT1", season: 2025, name: "Bonney Lake Qualifier", dateStart: "2025-11-08", dateEnd: "2025-11-08", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "in-progress" }];
const TEAMS = [3468, 111, 222, 333, 444].map((n) => ({ teamNumber: n, name: `Team ${n}` }));

function Fixture() {
  const q = useSearchParams();
  const size = Number(q.get("alliance") ?? 2);
  const withPlan = q.get("plan") === "1";
  const form = useMemo(() => buildForm(), []);
  const [values, setValues] = useState<FormValues>(() => defaultValues(form));
  const [entry, setEntry] = useState<FormEntryState>({ eventCode: "EVT1", matchKey: "Q5", alliance: q.get("alliance-chosen") === "0" ? null : "red", teamNumber: null, scoutName: "Ada" });
  const [planInfo, setPlanInfo] = useState<{ differences: number; linkedEntryId: string | null } | null>(null);
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [planValues, setPlanValues] = useState<FormValues>({ t1_role: "hive", t1_auto: true, t2_role: "flower", t2_auto: false, t3_role: "hive", t3_auto: false });

  const plan: PlanCandidate | null = withPlan ? { id: "plan-1", formId: "match-strategy-v1", eventCode: "EVT1", matchKey: "Q5", alliance: "red", createdAtMs: 1, values: planValues } : null;
  const allianceTeams = entry.alliance ? [3468, 111, 222].slice(0, size) : [];

  useEffect(() => {
    window.__fr = { values, entry, plan: planInfo, pending, errors };
  });

  return (
    <div className="mx-auto max-w-xl p-3">
      <PhotoUploadProvider
        deps={{
          getToken: async () => "test-token",
          uploader: async (item) => {
            await new Promise((r) => setTimeout(r, 300));
            return { url: `https://fixture.public.blob.vercel-storage.com/${item.id}.jpg`, pathname: `pit/${item.id}.jpg`, size: item.blob.size, contentType: "image/jpeg" };
          },
        }}
      >
        <FormRenderer
          form={form}
          values={values}
          onValuesChange={setValues}
          entry={entry}
          onEntryChange={(p) => setEntry((e) => ({ ...e, ...p }))}
          events={EVENTS}
          teams={TEAMS}
          allianceTeams={allianceTeams}
          errors={errors}
          photoTarget={{ kind: "pit", formId: form.id, eventCode: "EVT1", teamNumber: 3468 }}
          onPendingPhotos={(k, ids) => setPending((p) => ({ ...p, [k]: ids }))}
          plan={plan}
          onPlanChange={setPlanInfo}
          renderMatchPicker={(field) => <p data-testid="match-slot">{field.label}: Q5</p>}
        />
      </PhotoUploadProvider>
      <div className="mt-3 flex gap-2">
        <button type="button" data-testid="validate" onClick={() => setErrors(validateValues(form, values, { slotCount: size }))}>
          Check required
        </button>
        <button type="button" data-testid="change-plan" onClick={() => setPlanValues((p) => ({ ...p, t1_role: "flower" }))}>
          Change the plan
        </button>
      </div>
    </div>
  );
}

export function FormRendererFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}

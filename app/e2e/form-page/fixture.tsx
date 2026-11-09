"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormPageView, type PickedMatch } from "@/components/forms/form-page";
import type { NewFormEntry } from "@/lib/form-entries-model";
import { DRIVE_REFLECTION_FORM, LEAD_SCOUT_FORM, MATCH_STRATEGY_FORM } from "@/lib/forms/builtin-team-forms";
import type { PlanCandidate } from "@/lib/forms/compare";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { FtcEvent } from "@/lib/ftc/types";

declare global {
  interface Window {
    __saved?: NewFormEntry[];
  }
}

const FORMS = { lead: LEAD_SCOUT_FORM, strategy: MATCH_STRATEGY_FORM, reflection: DRIVE_REFLECTION_FORM } as const;
const TITLES = { lead: "Lead Scout Form", strategy: "Match Strategy Form", reflection: "Drive Reflection Form" } as const;

const EVENTS: FtcEvent[] = [
  { code: "EVT1", season: 2025, name: "Bonney Lake Qualifier", dateStart: "2025-11-08", dateEnd: "2025-11-08", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "in-progress" },
];
const match = (matchType: OfficialMatch["matchType"], matchNumber: number, red: number[], blue: number[]): OfficialMatch => ({ eventCode: "EVT1", matchType, matchNumber, played: false, red: { teams: red, score: null, penaltyPoints: null }, blue: { teams: blue, score: null, penaltyPoints: null } });
const MATCHES = [match("Qualification", 5, [1111, 2222], [3333, 4444]), match("Playoff", 2, [10, 20, 30], [40, 50, 60])];
const TEAMS = [10, 20, 30, 1111, 2222, 3333, 4444].map((n) => ({ teamNumber: n, name: `Team ${n}` }));

function Fixture() {
  const q = useSearchParams();
  const which = (q.get("form") ?? "lead") as keyof typeof FORMS;
  const form = FORMS[which];
  const [planValues, setPlanValues] = useState<Record<string, string | boolean>>({ t1_role: "hive", t1_auto: true, t2_role: "flower", t2_auto: false });
  const planEntries: PlanCandidate[] = q.get("plan") === "0" || which !== "reflection" ? [] : [{ id: "plan-1", formId: "match-strategy-v1", eventCode: "EVT1", matchKey: "Q5", alliance: "red", createdAtMs: 1, values: planValues }];
  const failNext = q.get("fail") === "1";

  useEffect(() => {
    window.__saved = [];
  }, []);

  return (
    <div className="mx-auto max-w-[1200px] p-3">
      <FormPageView
        form={form}
        title={TITLES[which]}
        subtitle="Fixture"
        events={EVENTS}
        eventsLoaded
        defaultEventCode="EVT1"
        scoutName="Ada Lovelace"
        matches={MATCHES}
        teams={TEAMS}
        planEntries={planEntries}
        renderMatchPicker={({ field, matchKey, onPick }) => (
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="fx-match">
              {field.label}
            </label>
            <select id="fx-match" data-testid="match-select" value={matchKey ?? ""} className="h-12 w-full rounded-2xl border bg-transparent px-3" onChange={(e) => e.target.value && onPick({ matchKey: e.target.value, matchType: e.target.value.startsWith("F") ? "Playoff" : "Qualification", match: null } satisfies PickedMatch)}>
              <option value="">Choose a match</option>
              <option value="Q5">Q5</option>
              <option value="F2">F2</option>
              <option value="Q9">Q9 (not on the schedule)</option>
            </select>
          </div>
        )}
        onSave={async (doc) => {
          if (failNext) throw new Error("offline");
          (window.__saved ??= []).push(doc);
          return `entry-${window.__saved.length}`;
        }}
      />
      <button type="button" data-testid="edit-plan" className="mt-4 rounded-full border px-3 py-2 text-sm" onClick={() => setPlanValues((p) => ({ ...p, t1_role: "flower" }))}>
        Edit the plan
      </button>
    </div>
  );
}

export function FormPageFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}

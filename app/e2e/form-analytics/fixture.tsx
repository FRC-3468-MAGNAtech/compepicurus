"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormAnalyticsView } from "@/components/analytics/form-analytics-page";
import { FORM_ANALYTICS_PAGES, formAnalyticsPage, selectFormEntries, type FormAnalyticsSlug } from "@/lib/analytics/form-analytics";
import { AnalyticsFilterProvider } from "@/lib/analytics/filter-context";
import type { FormEntry, NewFormEntry } from "@/lib/form-entries-model";
import { PitAndStrategyView } from "@/components/analytics/pit-and-strategy";
import { teamPitStrategy } from "@/lib/analytics/form-summaries";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";

declare global {
  interface Window {
    __entries?: FormEntry[];
    __saved?: NewFormEntry[];
  }
}

const svg = (color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='160' height='120' fill='${color}'/></svg>`)}`;
const photo = (color: string) => ({ url: svg(color), pathname: `p/${color}.svg`, size: 1, contentType: "image/svg+xml" });

let n = 0;
const base = (formId: string, formType: FormEntry["formType"], over: Partial<FormEntry>): FormEntry => ({
  id: `seed-${++n}`,
  teamId: "t",
  uid: "u1",
  scoutName: "Ada Lovelace",
  formId,
  formVersion: 1,
  formType,
  eventCode: "EVT1",
  teamNumber: null,
  values: {},
  stickyNotes: [],
  flags: [],
  excluded: false,
  createdAtMs: 1000 + n,
  updatedAtMs: 1000 + n,
  ...over,
});

const slotValues = (rows: [number, string, boolean][]) => Object.fromEntries(rows.flatMap(([team, role, auto], i) => [[`t${i + 1}_team`, team], [`t${i + 1}_role`, role], [`t${i + 1}_auto`, auto]]));

function seed(): FormEntry[] {
  n = 0;
  return [
    // Pit Scout: team 111 (two photos, a full grid, an auto cycle), team 222 twice (the later one wins), team 333 on a second event
    base("pit-scout-v1", "pit-scout", { teamNumber: 111, createdAtMs: 5000, values: { weight: 24.5, weightUnit: "lb", rookie: true, photos: [photo("tomato"), photo("steelblue")], friendlyPit: true, capabilities: { leave_auto: true, hive_auto: true, hive_teleop: true, park_teleop: true }, capacity: 6, preloaded: 2, cycleTime: 12.5, autoCycle: ["leave", "hive", "garden", "hive", "park"] }, stickyNotes: [{ id: "a", text: "tall robot", color: "yellow", createdAt: 1 }] }),
    base("pit-scout-v1", "pit-scout", { teamNumber: 222, scoutName: "Ben Franklin", createdAtMs: 1000, values: { weight: 20, weightUnit: "lb", cycleTime: 30 } }),
    base("pit-scout-v1", "pit-scout", { teamNumber: 222, scoutName: "Ben Franklin", createdAtMs: 2000, values: { weight: 10, weightUnit: "kg", cycleTime: 18, autoCycle: ["leave", "park"] } }),
    base("pit-scout-v1", "pit-scout", { teamNumber: 333, eventCode: "EVT2", createdAtMs: 3000, values: { weight: 15, weightUnit: "lb" } }),
    // Lead Scout
    base("lead-scout-v1", "lead-scout", { matchKey: "Q1", alliance: "red", values: { allianceNotes: "solid alliance", allianceSkill: 4, t1_team: 111, t1_skill: 5, t1_notes: "fast cycles", t2_team: 222, t2_skill: 3 } }),
    base("lead-scout-v1", "lead-scout", { matchKey: "Q2", alliance: "blue", scoutName: "Ben Franklin", values: { allianceSkill: 2, t1_team: 111, t1_skill: 3, t2_team: 444, t2_skill: 1 } }),
    // Team Strategy
    base("team-strategy-v1", "team-strategy", { teamNumber: 111, values: { bestAt: "hive", canScoreHive: true } }),
    base("team-strategy-v1", "team-strategy", { teamNumber: 222, values: { bestAt: "defense", shootWhileMoving: true } }),
    base("team-strategy-v1", "team-strategy", { teamNumber: 444, values: { bestAt: "defense" } }),
    // Match Strategy and Drive Reflection
    base("match-strategy-v1", "match-strategy", { matchKey: "Q1", alliance: "red", values: slotValues([[111, "hive", true], [222, "defense", false]]) }),
    base("match-strategy-v1", "match-strategy", { matchKey: "Q2", alliance: "blue", values: slotValues([[111, "garden", false], [444, "flower", false]]) }),
    base("drive-reflection-v1", "drive-reflection", { matchKey: "Q1", alliance: "red", planDifferences: 1, values: slotValues([[111, "hive", true], [222, "garden", false]]) }),
    base("drive-reflection-v1", "drive-reflection", { matchKey: "Q2", alliance: "blue", planDifferences: 0, values: slotValues([[111, "garden", false], [444, "flower", false]]) }),
    // Helper
    base("helper-v1", "helper", { teamNumber: 111, values: { successful: "yes", issues: "Loose intake belt" } }),
    base("helper-v1", "helper", { teamNumber: 222, values: { successful: "no", issues: "Bad servo" } }),
    base("helper-v1", "helper", { teamNumber: 333, scoutName: "Ben Franklin", values: { successful: "yes", issues: "Battery connector" } }),
  ];
}

const NAMES = new Map<number, string>([[111, "Rookies"], [222, "Veterans"], [333, "Third"], [444, "Fourth"]]);

function Fixture() {
  const q = useSearchParams();
  const slug = (q.get("page") ?? "pit-scout") as FormAnalyticsSlug;
  const page = formAnalyticsPage(slug) ?? FORM_ANALYTICS_PAGES[0];
  const admin = q.get("admin") === "1";
  const twoEvents = q.get("events") === "2";
  const events = useMemo(() => (twoEvents ? ["EVT1", "EVT2"] : ["EVT1"]), [twoEvents]);
  const [entries, setEntries] = useState<FormEntry[]>(() => (q.get("entries") === "none" ? [] : seed()));
  const form = BUILTIN_FORMS[page.formId];

  useEffect(() => {
    window.__entries = entries;
  }, [entries]);
  useEffect(() => {
    window.__saved = [];
  }, []);

  const profileTeam = q.get("profile") ? Number(q.get("profile")) : null;
  const scope = useMemo(() => selectFormEntries(entries, page.formType, events, { includeExcluded: true }), [entries, page.formType, events]);

  if (profileTeam !== null) {
    const info = teamPitStrategy(profileTeam, entries.filter((e) => !e.excluded));
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1100px] p-3">
        <AnalyticsFilterProvider>
          {info.any ? <PitAndStrategyView teamNumber={profileTeam} info={info} pitForm={BUILTIN_FORMS["pit-scout-v1"]} strategyForm={BUILTIN_FORMS["team-strategy-v1"]} /> : <p data-testid="profile-hidden">hidden</p>}
        </AnalyticsFilterProvider>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1100px] p-3">
      <AnalyticsFilterProvider>
        <FormAnalyticsView
          key={`${slug}-${q.get("events") ?? "1"}`}
          page={page}
          entries={scope}
          allEntries={entries}
          form={form}
          importForm={form}
          loaded={q.get("loaded") !== "0"}
          eventCodes={events}
          isAdmin={admin}
          teamNames={NAMES}
          importEvent="EVT1"
          initialView={q.get("view") === "summary" ? "summary" : "table"}
          onUpdate={(id, patch) => setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...patch } : e)))}
          onDelete={(id) => setEntries((cur) => cur.filter((e) => e.id !== id))}
          onImportSave={async (input) => {
            (window.__saved ??= []).push(input);
            setEntries((cur) => [...cur, { ...base(input.formId, input.formType, {}), ...input, id: `imp-${cur.length}`, teamId: "t", uid: "admin", teamNumber: input.teamNumber ?? null, stickyNotes: input.stickyNotes ?? [], flags: [], excluded: false }]);
          }}
        />
      </AnalyticsFilterProvider>
    </div>
  );
}

export function FormAnalyticsFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}

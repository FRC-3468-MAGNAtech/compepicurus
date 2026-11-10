"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormStatusView, type FormStatusViewProps } from "@/components/scout-status/form-status-panel";
import type { FormEntry } from "@/lib/form-entries-model";
import { CATEGORY_IDS } from "@/lib/scout-status/categories";
import type { CategoryRecord, EventContext, ScoutDescriptor, StatusMatch } from "@/lib/scout-status/compute";
import { allianceCoverage, allianceScoutRows, allianceUnits, checkableTeams, helperCountRows, statusEntries, teamCoverage, teamScoutRows, type TeamTargetSetup } from "@/lib/scout-status/form-status";
import { scoutStatusFormType } from "@/lib/scout-status/form-types";

declare global {
  interface Window {
    __targets?: { kind: "all" | "individual"; uid?: string; value: number | null }[];
  }
}

const NOW = 1_700_000_000_000; // fixed, so the server and the browser render the same "5 min ago"
let n = 0;
const entry = (formType: FormEntry["formType"], over: Partial<FormEntry>): FormEntry => ({
  id: `s${++n}`, teamId: "t", uid: "u1", scoutName: "Ada Lovelace", formId: "x", formVersion: 1, formType, eventCode: "EVT1", teamNumber: null, values: {}, stickyNotes: [], flags: [], excluded: false, createdAtMs: NOW - n * 60_000, updatedAtMs: 0, ...over,
});
const match = (number: number): StatusMatch => ({ key: `EVT1|Qualification|${number}`, eventCode: "EVT1", matchType: "Qualification", matchNumber: number, category: "qualification", label: `Q${number}`, played: true, red: [111, 222], blue: [333, 444] });
const ctx: EventContext = { eventCode: "EVT1", matches: [match(1), match(2)], categoryOf: () => "qualification", includes: () => true, hasSchedule: true, parsedRanges: {} as never };
const SCOUTS: ScoutDescriptor[] = [{ uid: "u1", name: "Ada Lovelace", role: "Lead Scout", inTargets: true }, { uid: "u2", name: "Ben Franklin", role: "Pit Scout", inTargets: true }];
const TEAMS = [111, 222, 333, 444];
const OURS = new Set([222]);
const photo = { url: `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='60'><rect width='80' height='60' fill='tomato'/></svg>")}`, pathname: "p", size: 1, contentType: "image/svg+xml" };

function build(typeId: string, assigned: boolean, includeOurs: boolean, setAll: number | null, individual: Record<string, number>, onTarget: (t: NonNullable<Window["__targets"]>[number]) => void, setIncludeOurs: (v: boolean) => void): Omit<FormStatusViewProps, "type" | "now" | "multiEvent"> {
  const type = scoutStatusFormType(typeId);
  n = 0; // the same ids and times on the server and in the browser
  const nameFor = (_u: string, f: string) => f;
  if (type.unit === "match-alliance") {
    const units = allianceUnits([ctx]);
    const targets = new Map<string, CategoryRecord<number | null>>(SCOUTS.map((s) => [s.uid, Object.fromEntries(CATEGORY_IDS.map((c) => [c, c === "qualification" ? 3 : 0])) as CategoryRecord<number | null>]));
    const lead = [entry("lead-scout", { matchKey: "Q1", alliance: "red" }), entry("lead-scout", { matchKey: "Q1", alliance: "blue" }), entry("lead-scout", { matchKey: "Q2", alliance: "red", uid: "u2", scoutName: "Ben Franklin" })];
    const plans = [entry("match-strategy", { matchKey: "Q1", alliance: "red" }), entry("match-strategy", { matchKey: "Q1", alliance: "blue" })];
    const refl = [entry("drive-reflection", { matchKey: "Q1", alliance: "red", planDifferences: 2 })];
    const entries = typeId === "drive-reflection" ? refl : typeId === "match-strategy" ? plans : lead;
    return { alliance: { rows: allianceScoutRows({ scouts: SCOUTS, entries: statusEntries(entries, type.formType!, ["EVT1"]), units, targets, playedFraction: 1, nameFor }), coverage: allianceCoverage(units, entries, typeId === "drive-reflection" ? plans : []) } };
  }
  if (type.unit === "team") {
    const entries = [entry(type.formType!, { teamNumber: 111, values: { photos: [photo] } }), entry(type.formType!, { teamNumber: 333, uid: "u2", scoutName: "Ben Franklin" })];
    const setup: TeamTargetSetup = { all: setAll, individual };
    return {
      team: {
        rows: teamScoutRows({ scouts: SCOUTS, entries, setupFor: () => setup, eventCodes: ["EVT1"], assignedCounts: assigned ? new Map([["u1", 2]]) : null, nameFor }),
        coverage: teamCoverage(checkableTeams(TEAMS, (t) => OURS.has(t), includeOurs), entries),
        includeOurs,
        onIncludeOurs: setIncludeOurs,
        isOurs: (t) => OURS.has(t),
        all: setAll,
        canEdit: true,
        onSetAll: (v) => onTarget({ kind: "all", value: v }),
        onSetIndividual: (uid, v) => onTarget({ kind: "individual", uid, value: v }),
      },
    };
  }
  const helper = [entry("helper", { values: { successful: "yes" } }), entry("helper", { values: { successful: "no" } }), entry("helper", { uid: "u2", scoutName: "Ben Franklin", values: { successful: "yes" } })];
  return { helper: helperCountRows({ scouts: SCOUTS, entries: helper, nameFor }) };
}

function Fixture() {
  const q = useSearchParams();
  const typeId = q.get("type") ?? "lead-scout";
  const [includeOurs, setIncludeOurs] = useState(false);
  const [setAll, setSetAll] = useState<number | null>(q.get("all") ? Number(q.get("all")) : null);
  const [individual, setIndividual] = useState<Record<string, number>>({});
  useEffect(() => {
    window.__targets = [];
  }, []);
  const props = useMemo(
    () =>
      build(typeId, q.get("assigned") === "1", includeOurs, setAll, individual, (t) => {
        (window.__targets ??= []).push(t);
        if (t.kind === "all") setSetAll(t.value);
        else if (t.uid) setIndividual((cur) => (t.value === null ? Object.fromEntries(Object.entries(cur).filter(([k]) => k !== t.uid)) : { ...cur, [t.uid!]: t.value }));
      }, setIncludeOurs),
    [typeId, q, includeOurs, setAll, individual]
  );
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1000px] p-3">
      <FormStatusView type={scoutStatusFormType(typeId)} now={NOW} multiEvent={false} {...props} />
    </div>
  );
}

export function FormStatusFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}

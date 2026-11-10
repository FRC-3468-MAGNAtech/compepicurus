"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TeamAssignmentsView, type ScoutOption } from "@/components/assignments/team-assignments-panel";
import type { TeamAssignKind, TeamAssignmentsDoc, TeamAssignVersion } from "@/lib/team-assignments/model";

declare global {
  interface Window {
    __published?: TeamAssignVersion[];
  }
}

const TEAMS = Array.from({ length: 12 }, (_, i) => ({ teamNumber: 100 + i, name: `Team ${100 + i}` }));
const OURS = new Set([100]);
const ELIGIBLE: ScoutOption[] = [
  { uid: "a", name: "Ada", role: "Pit Scout" },
  { uid: "b", name: "Ben", role: "Pit Scout" },
  { uid: "c", name: "Cy", role: "Pit Scout" },
];
const OTHERS: ScoutOption[] = [{ uid: "d", name: "Di", role: "Media", noAccess: true }];
const NAMES: Record<string, string> = { a: "Ada", b: "Ben", c: "Cy", d: "Di" };

const version = (rows: [number, string[]][], generatedAt: string): TeamAssignVersion => ({
  generatedBy: "lead",
  generatedAt,
  settings: { scoutUids: ["a", "b", "c"], priorityTeams: [], priorityCoverage: 2, mode: "balanced-random", includeOurs: false, seed: 3 },
  teams: rows.map(([teamNumber, scoutUids]) => ({ teamNumber, scoutUids, locked: false })),
  counts: {},
  uneven: false,
  warning: null,
});

function Fixture() {
  const q = useSearchParams();
  const kind = (q.get("kind") ?? "pit") as TeamAssignKind;
  const canEdit = q.get("edit") !== "0";
  const [doc, setDoc] = useState<TeamAssignmentsDoc | null>(() =>
    q.get("published") === "1" ? { id: "t_E_pit", teamId: "t", eventCode: "E", kind, current: version([[101, ["a"]], [102, ["a", "b"]], [103, ["c"]], [104, ["a"]]], "2026-11-08T10:00:00.000Z"), previous: q.get("previous") === "1" ? version([[101, ["b"]]], "2026-11-07T10:00:00.000Z") : null } : null
  );
  useEffect(() => {
    window.__published = [];
  }, []);
  const done = new Set<number>(q.get("done") ? q.get("done")!.split(",").map(Number) : []);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[900px] p-3">
      <TeamAssignmentsView
        kind={kind}
        teams={TEAMS}
        isOurs={(t) => OURS.has(t)}
        eligible={q.get("none") === "1" ? [] : ELIGIBLE}
        others={OTHERS}
        published={doc}
        canEdit={canEdit}
        me={q.get("me") ?? "a"}
        done={done}
        nameOf={(uid) => NAMES[uid] ?? uid}
        onPublish={(v) => {
          const full: TeamAssignVersion = { ...v, generatedBy: "lead", generatedAt: "2026-11-08T12:00:00.000Z" };
          (window.__published ??= []).push(full);
          setDoc((cur) => ({ id: "t_E_pit", teamId: "t", eventCode: "E", kind, current: full, previous: cur?.current ?? null }));
        }}
        onUndo={() => setDoc((cur) => (cur?.previous ? { ...cur, current: cur.previous, previous: null } : cur))}
      />
    </div>
  );
}

export function TeamAssignmentsFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}

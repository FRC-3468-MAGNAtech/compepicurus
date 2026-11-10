import { describe, expect, it } from "vitest";
import { distributeTeams, assignmentProgress } from "@/lib/team-assignments/distribute";
import { assignedTeamCounts, myAssignedTeams, type TeamAssignmentsDoc, type TeamAssignVersion } from "@/lib/team-assignments/model";
import { pendingNotice } from "@/components/layout/team-assignments-watcher";
import { teamScoutRows } from "@/lib/scout-status/form-status";
import type { FormEntry } from "@/lib/form-entries-model";

// P31: the pieces together: a lead hands the teams out and publishes; a scout's form, dashboard, notice and Scout Status all read the same published version.

const SCOUTS = ["ada", "ben", "cy"];
const TEAMS = Array.from({ length: 10 }, (_, i) => 200 + i);

function publish(kind: "pit" | "teamStrategy", seed: number, previous: TeamAssignVersion | null = null): TeamAssignmentsDoc {
  const r = distributeTeams({ teams: TEAMS, scoutUids: SCOUTS, mode: "balanced-random", priorityTeams: [205], priorityCoverage: 2, locked: [], seed });
  const current: TeamAssignVersion = { generatedBy: "lead", generatedAt: "2026-11-08T11:00:00.000Z", settings: { scoutUids: SCOUTS, priorityTeams: [205], priorityCoverage: 2, mode: "balanced-random", includeOurs: false, seed }, teams: r.rows, counts: r.counts, uneven: r.uneven, warning: r.warning };
  return { id: `t_E_${kind}`, teamId: "t", eventCode: "E", kind, current, previous };
}

const entry = (uid: string, teamNumber: number, formType: FormEntry["formType"] = "pit-scout"): FormEntry => ({ id: `${uid}${teamNumber}`, teamId: "t", uid, scoutName: uid, formId: "pit-scout-v1", formVersion: 1, formType, eventCode: "E", teamNumber, values: {}, stickyNotes: [], flags: [], excluded: false, createdAtMs: 1, updatedAtMs: 1 });

describe("one published assignment, read everywhere", () => {
  const pit = publish("pit", 11);
  const strategy = publish("teamStrategy", 12);
  const docs = [pit, strategy];

  it("every team is covered; each scout's teams (form quick-pick, dashboard) add up to the published counts", () => {
    const mine = SCOUTS.map((u) => myAssignedTeams(docs, "E", "pit", u));
    expect(mine.flat().length).toBe(11); // 10 teams + the second scout on 205
    expect(new Set(mine.flat())).toEqual(new Set(TEAMS));
    expect(mine.map((m) => m.length)).toEqual(SCOUTS.map((u) => pit.current!.counts[u]));
    // the kinds don't bleed into each other
    expect(myAssignedTeams([pit], "E", "teamStrategy", "ada")).toEqual([]);
  });

  it("progress ('7 of 12 done') follows the person's own entries, for their teams only", () => {
    const [first] = myAssignedTeams(docs, "E", "pit", "ada");
    const entries = [entry("ada", first), entry("ben", first), entry("ada", 999)];
    const done = new Set(entries.filter((e) => e.uid === "ada").map((e) => e.teamNumber as number));
    const p = assignmentProgress(myAssignedTeams(docs, "E", "pit", "ada"), done);
    expect(p.done).toBe(1);
    expect(p.total).toBe(pit.current!.counts.ada);
    expect(p.remaining).not.toContain(first);
  });

  it("Scout Status prefills each scout's target from the assignment, and a manual number overrides it", () => {
    const counts = assignedTeamCounts(docs, ["E"], "pit")!;
    const scouts = SCOUTS.map((uid) => ({ uid, name: uid, role: null, inTargets: true }));
    const rows = teamScoutRows({ scouts, entries: [], setupFor: () => ({ individual: { cy: 99 } }), eventCodes: ["E"], assignedCounts: counts, nameFor: (_u, f) => f });
    for (const u of ["ada", "ben"]) expect(rows.find((r) => r.uid === u)!.target).toEqual({ value: pit.current!.counts[u], source: "assignments" });
    expect(rows.find((r) => r.uid === "cy")!.target).toEqual({ value: 99, source: "manual" });
    // a scout who did all of theirs is Complete
    const ada = myAssignedTeams(docs, "E", "pit", "ada");
    const done = teamScoutRows({ scouts, entries: ada.map((t) => entry("ada", t)), setupFor: () => undefined, eventCodes: ["E"], assignedCounts: counts, nameFor: (_u, f) => f });
    expect(done.find((r) => r.uid === "ada")!.status).toBe("complete");
  });

  it("with nothing published, there is nothing to prefill and nothing to announce", () => {
    expect(assignedTeamCounts([], ["E"], "pit")).toBeNull();
    expect(pendingNotice([], "ada", Date.parse("2026-11-08T12:00:00.000Z"), () => null)).toBeNull();
  });

  it("the notice reaches exactly the scouts who have teams, and a republish is announced again", () => {
    const now = Date.parse("2026-11-08T12:00:00.000Z");
    for (const u of SCOUTS) expect(pendingNotice([pit], u, now, () => null)?.count).toBe(pit.current!.counts[u]);
    expect(pendingNotice([pit], "lead", now, () => null)).toBeNull(); // the lead scouts nothing
    const again = { ...pit, current: { ...pit.current!, generatedAt: "2026-11-08T11:45:00.000Z" } };
    expect(pendingNotice([again], "ada", now, () => pit.current!.generatedAt)).not.toBeNull();
  });

  it("undo is one level: the previous version becomes current and the readers follow", () => {
    const v1 = publish("pit", 1);
    const v2 = publish("pit", 2, v1.current);
    expect(v2.previous).toEqual(v1.current);
    const undone: TeamAssignmentsDoc = { ...v2, current: v2.previous, previous: null };
    expect(myAssignedTeams([undone], "E", "pit", "ada")).toEqual(myAssignedTeams([v1], "E", "pit", "ada"));
  });
});

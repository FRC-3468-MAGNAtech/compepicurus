import { describe, expect, it } from "vitest";
import { assignedTeamCounts, isNewPublish, myAssignedTeams, parseTeamAssignmentsDoc, TEAM_ASSIGN_KIND_INFO, type TeamAssignmentsDoc, type TeamAssignVersion } from "@/lib/team-assignments/model";
import { getPage } from "@/lib/page-access/pages";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";

const version = (rows: [number, string[]][], generatedAt = "2026-11-08T10:00:00.000Z"): TeamAssignVersion => ({
  generatedBy: "lead",
  generatedAt,
  settings: { scoutUids: ["a", "b"], priorityTeams: [], priorityCoverage: 2, mode: "balanced-random", includeOurs: false, seed: 1 },
  teams: rows.map(([teamNumber, scoutUids]) => ({ teamNumber, scoutUids, locked: false })),
  counts: {},
  uneven: false,
  warning: null,
});
const doc = (eventCode: string, kind: "pit" | "teamStrategy", current: TeamAssignVersion | null): TeamAssignmentsDoc => ({ id: `t_${eventCode}_${kind}`, teamId: "t", eventCode, kind, current, previous: null });

describe("the two kinds", () => {
  it("each names a real form and a registered page", () => {
    for (const info of Object.values(TEAM_ASSIGN_KIND_INFO)) {
      expect(BUILTIN_FORMS[info.formId], info.kind).toBeTruthy();
      expect(getPage(info.pageId)?.routes[0], info.kind).toBe(info.href);
    }
  });
});

describe("parsing a stored doc", () => {
  const raw = { teamId: "t", eventCode: "E", kind: "pit", current: { generatedBy: "u", generatedAt: "2026-01-01T00:00:00Z", settings: { scoutUids: ["a"], priorityCoverage: 1, mode: "sequential-blocks", includeOurs: true, seed: 5, priorityTeams: [3] }, teams: [{ teamNumber: 1, scoutUids: ["a", 7], locked: true }, { teamNumber: "x" }, null], counts: { a: 1 }, uneven: true, warning: "w" }, previous: null };

  it("keeps what is well formed and drops what isn't", () => {
    const d = parseTeamAssignmentsDoc("t_E_pit", raw)!;
    expect(d).toMatchObject({ id: "t_E_pit", teamId: "t", eventCode: "E", kind: "pit", previous: null });
    expect(d.current).toMatchObject({ generatedBy: "u", uneven: true, warning: "w", counts: { a: 1 } });
    expect(d.current!.teams).toEqual([{ teamNumber: 1, scoutUids: ["a"], locked: true }]);
    expect(d.current!.settings).toEqual({ scoutUids: ["a"], priorityTeams: [3], priorityCoverage: 1, mode: "sequential-blocks", includeOurs: true, seed: 5 });
  });

  it("is null for a Match Scouting doc (no kind), a bad kind, or a doc with no team or event", () => {
    expect(parseTeamAssignmentsDoc("x", { teamId: "t", eventCode: "E", current: null })).toBeNull();
    expect(parseTeamAssignmentsDoc("x", { ...raw, kind: "other" })).toBeNull();
    expect(parseTeamAssignmentsDoc("x", { kind: "pit" })).toBeNull();
    expect(parseTeamAssignmentsDoc("x", { ...raw, current: "junk" })?.current).toBeNull();
  });
});

describe("reading published versions", () => {
  const docs = [doc("A", "pit", version([[1, ["a"]], [2, ["a", "b"]], [3, ["b"]]])), doc("B", "pit", version([[4, ["a"]]])), doc("A", "teamStrategy", version([[1, ["b"]]])), doc("C", "pit", null)];

  it("teams per scout, per kind, summed over the events asked for; null with nothing published", () => {
    expect(assignedTeamCounts(docs, ["A"], "pit")).toEqual(new Map([["a", 2], ["b", 2]]));
    expect(assignedTeamCounts(docs, ["A", "B"], "pit")).toEqual(new Map([["a", 3], ["b", 2]]));
    expect(assignedTeamCounts(docs, ["A"], "teamStrategy")).toEqual(new Map([["b", 1]]));
    expect(assignedTeamCounts(docs, ["C"], "pit")).toBeNull();
    expect(assignedTeamCounts(docs, ["Z"], "pit")).toBeNull();
  });

  it("a person's own teams for one event and kind", () => {
    expect(myAssignedTeams(docs, "A", "pit", "a")).toEqual([1, 2]);
    expect(myAssignedTeams(docs, "A", "pit", "nobody")).toEqual([]);
    expect(myAssignedTeams(docs, "A", "teamStrategy", "a")).toEqual([]);
    expect(myAssignedTeams(docs, null, "pit", "a")).toEqual([]);
    expect(myAssignedTeams(docs, "A", "pit", undefined)).toEqual([]);
  });
});

describe("announcing a publish", () => {
  const now = Date.parse("2026-11-08T12:00:00.000Z");
  const DAY = 86_400_000;

  it("only a version I haven't seen, and not an old one", () => {
    const v = { generatedAt: "2026-11-08T10:00:00.000Z" };
    expect(isNewPublish(v, null, now, DAY)).toBe(true);
    expect(isNewPublish(v, "2026-11-08T10:00:00.000Z", now, DAY)).toBe(false); // seen
    expect(isNewPublish(v, "2026-11-01T00:00:00.000Z", now, DAY)).toBe(true); // an older one was seen: this is new
    expect(isNewPublish({ generatedAt: "2026-11-01T10:00:00.000Z" }, null, now, DAY)).toBe(false); // too old to announce
    expect(isNewPublish(null, null, now, DAY)).toBe(false);
    expect(isNewPublish({ generatedAt: "nonsense" }, null, now, DAY)).toBe(false);
  });
});

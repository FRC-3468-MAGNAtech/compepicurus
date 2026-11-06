import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatchCoverage, ScoutRow } from "@/lib/scout-status/compute";
import { CoverageList } from "./coverage-list";
import { StatusTable } from "./status-table";

// React separates adjacent text nodes with comment markers; strip them so the assertions read the visible text.
const text = (html: string) => html.replace(/<!-- -->/g, "");

const ALL = new Set(["practice", "qualification", "semi", "final"] as const);

const robot = (teamNumber: number, alliance: "red" | "blue", names: string[] = []) => ({ teamNumber, alliance, scouts: names.map((name, i) => ({ uid: `${name}${i}`, name })) });
const match = (n: number, state: "played" | "upcoming", robots: ReturnType<typeof robot>[]): MatchCoverage => ({
  match: { key: `EV|Qualification|${n}`, eventCode: "EV", matchType: "Qualification", matchNumber: n, category: "qualification", label: `Q${n}`, played: state === "played", red: [], blue: [] },
  robots,
  scoutedCount: robots.filter((r) => r.scouts.length > 0).length,
  state,
});

describe("CoverageList", () => {
  const coverage = [
    match(1, "played", [robot(101, "red", ["Ada", "Bo"]), robot(201, "red"), robot(301, "blue", ["Ada"]), robot(401, "blue", ["Cy"])]),
    match(2, "upcoming", [robot(102, "red"), robot(202, "red"), robot(302, "blue"), robot(402, "blue")]),
  ];

  it("groups red then blue, labels the match, and summarizes 3/4 scouted", () => {
    const html = text(renderToString(<CoverageList coverage={coverage} enabled={ALL} showEvent={false} />));
    expect(html).toContain("Q1");
    expect(html).toContain("3/4 scouted");
    expect(html.indexOf("101")).toBeLessThan(html.indexOf("301")); // red pair before blue pair
  });

  it("shows a check per scout (two scouts on one robot = two checks), with names for assistive tech", () => {
    const html = text(renderToString(<CoverageList coverage={coverage} enabled={ALL} showEvent={false} />));
    expect(html).toContain("Team 101, scouted by Ada, Bo");
    expect((html.match(/lucide-check/g) ?? []).length).toBe(4); // 2 + 1 + 1
  });

  it("marks a played, unscouted robot with an X, but an upcoming match stays muted (no X)", () => {
    const html = text(renderToString(<CoverageList coverage={coverage} enabled={ALL} showEvent={false} />));
    expect(html).toContain("Team 201, not scouted"); // Q1 is played and robot 201 was missed
    expect(html).toContain("Team 102, not yet played"); // Q2 is upcoming
    expect(html).not.toContain("Team 102, not scouted");
    expect(html).toContain("upcoming");
  });

  it("says so when there is nothing to show", () => {
    expect(text(renderToString(<CoverageList coverage={[]} enabled={ALL} showEvent={false} />))).toContain("No matches to show");
  });

  it("names the event on each row once several events are shown", () => {
    expect(text(renderToString(<CoverageList coverage={coverage} enabled={ALL} showEvent />))).toContain(">EV<");
  });
});

describe("StatusTable", () => {
  const row = (over: Partial<ScoutRow>): ScoutRow => ({
    uid: "a",
    name: "Ada",
    role: "Match Scout",
    inTargets: true,
    matchesScouted: 4,
    entries: 5,
    byCategory: { practice: { entries: 0, target: null }, qualification: { entries: 5, target: 10 }, semi: { entries: 0, target: null }, final: { entries: 0, target: null } },
    target: 10,
    lastEntry: { atMs: Date.parse("2026-11-05T10:00:00Z"), label: "Q5", eventCode: "EV" },
    avgAccuracy: 91.4,
    flagged: 1,
    missingAssigned: 2,
    status: "behind",
    ...over,
  });
  const rows = [row({}), row({ uid: "z", name: "Zed", inTargets: false, status: "no-target", target: null, entries: 2, matchesScouted: 2, avgAccuracy: null, flagged: 0, lastEntry: null, missingAssigned: null })];
  const render = (hasAssignments: boolean) =>
    text(renderToString(<StatusTable rows={rows} totals={{ matchesScouted: 6, entries: 7, target: 10, flagged: 1, avgAccuracy: 91.4 }} entries={[]} events={[]} enabled={ALL} hasAssignments={hasAssignments} now={Date.parse("2026-11-05T11:00:00Z")} />));

  it("shows entries / target, the per-category chips, the accuracy, the status pill, and the totals row", () => {
    const html = render(true);
    expect(html).toContain("5 / 10");
    expect(html).toContain("Q 5/10");
    expect(html).toContain("91%");
    expect(html).toContain("Behind");
    expect(html).toContain("Total");
    expect(html).toContain("7 / 10");
  });

  it("flags a scout who has entries but is not in the targets list", () => {
    expect(render(true)).toContain("not in targets");
  });

  it("shows the last entry as relative time with the match label", () => {
    const html = render(true);
    expect(html).toContain("1 h ago");
    expect(html).toContain("Q5");
  });

  it("shows the Missing assigned column only when a schedule is published", () => {
    expect(render(true)).toContain("Missing assigned");
    expect(render(false)).not.toContain("Missing assigned");
  });

  it("has sortable, labelled columns", () => {
    expect(render(true)).toContain('aria-sort="ascending"'); // the default sort: status
  });
});

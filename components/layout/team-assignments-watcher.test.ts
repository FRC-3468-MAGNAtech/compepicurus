import { describe, expect, it } from "vitest";
import { pendingNotice } from "@/components/layout/team-assignments-watcher";
import type { TeamAssignmentsDoc, TeamAssignVersion } from "@/lib/team-assignments/model";

const now = Date.parse("2026-11-08T12:00:00.000Z");
const version = (generatedAt: string, rows: [number, string[]][]): TeamAssignVersion => ({
  generatedBy: "lead",
  generatedAt,
  settings: { scoutUids: [], priorityTeams: [], priorityCoverage: 2, mode: "balanced-random", includeOurs: false, seed: 1 },
  teams: rows.map(([teamNumber, scoutUids]) => ({ teamNumber, scoutUids, locked: false })),
  counts: {},
  uneven: false,
  warning: null,
});
const doc = (id: string, kind: "pit" | "teamStrategy", current: TeamAssignVersion | null): TeamAssignmentsDoc => ({ id, teamId: "t", eventCode: "EVT1", kind, current, previous: null });

describe("the in-app notice when assignments are published", () => {
  const fresh = "2026-11-08T11:00:00.000Z";
  const docs = [doc("d-pit", "pit", version(fresh, [[1, ["me"]], [2, ["me", "x"]], [3, ["x"]]])), doc("d-ts", "teamStrategy", version(fresh, [[1, ["x"]]]))];

  it("announces a recent version I have teams in, with how many", () => {
    expect(pendingNotice(docs, "me", now, () => null)).toEqual({ docId: "d-pit", generatedAt: fresh, kind: "pit", eventCode: "EVT1", count: 2 });
  });

  it("not once I've seen that version, but again when it is republished", () => {
    expect(pendingNotice(docs, "me", now, () => fresh)).toBeNull();
    const republished = [doc("d-pit", "pit", version("2026-11-08T11:30:00.000Z", [[1, ["me"]]]))];
    expect(pendingNotice(republished, "me", now, () => fresh)).toMatchObject({ count: 1 });
  });

  it("not when I have no teams in it, when it is old, or when nothing is published", () => {
    expect(pendingNotice(docs, "someone-else", now, () => null)).toBeNull();
    expect(pendingNotice([doc("d", "pit", version("2026-11-01T00:00:00.000Z", [[1, ["me"]]]))], "me", now, () => null)).toBeNull();
    expect(pendingNotice([doc("d", "pit", null)], "me", now, () => null)).toBeNull();
    expect(pendingNotice([], "me", now, () => null)).toBeNull();
  });

  it("asks about each document's own seen marker, and skips to the next unseen one", () => {
    const both = [doc("d-pit", "pit", version(fresh, [[1, ["me"]]])), doc("d-ts", "teamStrategy", version(fresh, [[1, ["me"]]]))];
    expect(pendingNotice(both, "me", now, (id) => (id === "d-pit" ? fresh : null))?.docId).toBe("d-ts");
  });
});

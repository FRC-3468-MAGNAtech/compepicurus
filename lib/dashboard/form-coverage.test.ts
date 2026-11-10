import { describe, expect, it } from "vitest";
import { entriesOfType, formCoverage, helperSummary, myTeams } from "@/lib/dashboard/form-coverage";
import type { FormEntry } from "@/lib/form-entries-model";

const entry = (over: Partial<FormEntry>): FormEntry => ({
  id: Math.random().toString(36).slice(2),
  teamId: "t",
  uid: "u1",
  scoutName: "A",
  formId: "pit-scout-v1",
  formVersion: 1,
  formType: "pit-scout",
  eventCode: "EVT1",
  teamNumber: 111,
  values: {},
  stickyNotes: [],
  flags: [],
  excluded: false,
  createdAtMs: 1,
  updatedAtMs: 1,
  ...over,
});

describe("formCoverage", () => {
  const entries = [entry({ teamNumber: 111 }), entry({ teamNumber: 111, uid: "u2" }), entry({ teamNumber: 222 }), entry({ teamNumber: 333, formType: "team-strategy" }), entry({ teamNumber: 444, excluded: true })];

  it("counts a team once however many scouts did it, only for the form type asked, and lists who is missing in order", () => {
    expect(formCoverage([444, 333, 222, 111, 555], entries, "pit-scout")).toEqual({ total: 5, done: 2, percent: 40, missing: [333, 444, 555] });
    expect(formCoverage([111, 333], entries, "team-strategy")).toMatchObject({ done: 1, missing: [111] });
  });

  it("ignores entries for teams outside the list, duplicates in the list, and an empty list gives no percent", () => {
    expect(formCoverage([111, 111], entries, "pit-scout")).toMatchObject({ total: 1, done: 1, percent: 100, missing: [] });
    expect(formCoverage([], entries, "pit-scout")).toEqual({ total: 0, done: 0, percent: null, missing: [] });
  });

  it("excluded entries don't count", () => {
    expect(entriesOfType(entries, "pit-scout")).toHaveLength(3);
  });
});

describe("myTeams", () => {
  it("is the teams I submitted for", () => {
    const entries = [entry({ teamNumber: 1 }), entry({ teamNumber: 2, uid: "u2" }), entry({ teamNumber: 3, formType: "helper" })];
    expect([...myTeams(entries, "pit-scout", "u1")]).toEqual([1]);
  });
});

describe("helperSummary", () => {
  it("counts assists and the success rate, newest first", () => {
    const entries = [
      entry({ formType: "helper", values: { successful: "yes" }, createdAtMs: 1 }),
      entry({ formType: "helper", values: { successful: "no" }, createdAtMs: 3 }),
      entry({ formType: "helper", values: { successful: "yes" }, createdAtMs: 2 }),
      entry({ formType: "pit-scout" }),
    ];
    const s = helperSummary(entries, 2);
    expect(s).toMatchObject({ total: 3, successful: 2, rate: 67 });
    expect(s.recent.map((e) => e.createdAtMs)).toEqual([3, 2]);
    expect(helperSummary([])).toEqual({ total: 0, successful: 0, rate: null, recent: [] });
  });
});

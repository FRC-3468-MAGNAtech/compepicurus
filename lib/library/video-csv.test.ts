import { describe, expect, it } from "vitest";
import { evaluatePracticeSessionFlags } from "@/lib/practice-flags";
import { initialScoutEntryFields, type ScoutEntry } from "@/lib/scout-entries";
import { parseVideoCsv } from "./video-csv";
import { clipProgress } from "./video-window";

describe("the bulk video CSV (matchKey,url,startSec,endSec)", () => {
  const url = "https://youtu.be/dQw4w9WgXcQ";

  it("accepts blank times in every combination", () => {
    const { rows, errors } = parseVideoCsv(["matchKey,url,startSec,endSec", `A_Q1,${url},,`, `A_Q2,${url},30,`, `A_Q3,${url},,150`, `A_Q4,${url},30,150`].join("\n"));
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.startSec, r.endSec])).toEqual([[null, null], [30, null], [null, 150], [30, 150]]);
  });

  it("accepts rows that stop before the time columns", () => {
    const { rows, errors } = parseVideoCsv(`A_Q1,${url}\nA_Q2,${url},45`);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.startSec, r.endSec])).toEqual([[null, null], [45, null]]);
  });

  it("reads 1:30 style times as well as seconds", () => {
    expect(parseVideoCsv(`A_Q1,${url},1:10,3:40`).rows[0]).toMatchObject({ startSec: 70, endSec: 220 });
  });

  it("rejects an unreadable time, a missing key or link, and an end before the start (only when both are given)", () => {
    const { rows, errors } = parseVideoCsv([`A_Q1,${url},abc,`, `A_Q2,${url},,later`, `A_Q3,${url},200,100`, `,${url},,`, `A_Q5,,,`, `A_Q6,${url},,`].join("\n"));
    expect(rows.map((r) => r.matchKey)).toEqual(["A_Q6"]);
    expect(errors).toHaveLength(5);
  });
});

// The "Finished Early" flag (Competitive mode) must follow the clip's real length when the end time is blank.
describe("the Finished Early flag with optional times", () => {
  const entry = (total: number): ScoutEntry => ({
    id: "e", teamId: "t", uid: "u", source: "practice", mode: "competitive", formId: "biobuzz", formVersion: 1, scoutName: "S", eventCode: "USWABON1",
    matchType: "Qualification", matchNumber: 1, teamNumber: 100, fields: initialScoutEntryFields, score: { auto: total, teleop: 0, endgame: 0, total },
    comments: "", submittedAt: "2026-11-05T00:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: "PS-ABCDEF", libraryMatchId: "USWABON1_Q1",
  });
  const flagFor = (videoProgressAtFinish: number | null) =>
    evaluatePracticeSessionFlags({ entries: [entry(40), entry(30)], mode: "competitive", videoProgressAtFinish, priorCompletedAttempt: false }).map((f) => f.type);

  it("flags finishing at 50% of a clip, and skips the flag when the progress is unknown", () => {
    expect(flagFor(0.5)).toContain("finished-early");
    expect(flagFor(0.95)).not.toContain("finished-early");
    expect(flagFor(null)).not.toContain("finished-early");
  });

  it("end given: progress comes from end - start", () => {
    expect(clipProgress(30 + 60, { startSec: 30, endSec: 180 }, null)).toBeCloseTo(0.4, 5); // 60 of 150 seconds
    expect(flagFor(clipProgress(30 + 60, { startSec: 30, endSec: 180 }, null))).toContain("finished-early");
  });

  it("end blank: progress comes from the video's duration minus the start", () => {
    const progress = clipProgress(30 + 100, { startSec: 30, endSec: null }, 630); // 100 of 600 seconds
    expect(progress).toBeCloseTo(100 / 600, 5);
    expect(flagFor(progress)).toContain("finished-early");
    expect(flagFor(clipProgress(30 + 590, { startSec: 30, endSec: null }, 630))).not.toContain("finished-early");
  });

  it("end blank and duration unknown: no flag at all", () => {
    expect(flagFor(clipProgress(120, { startSec: null, endSec: null }, null))).not.toContain("finished-early");
  });
});

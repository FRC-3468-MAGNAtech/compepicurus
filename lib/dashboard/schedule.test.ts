import { describe, expect, it } from "vitest";
import type { OfficialAlliance, OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { FtcRanking } from "@/lib/ftc/types";
import {
  buildOurMatches,
  formatRecord,
  matchShareText,
  nextOurMatch,
  ourRecord,
  recentOurResults,
  upcomingOurMatches,
} from "./schedule";
import { formatCountdown, parseEventTime, timeAgo, tzOffsetMs } from "./time";

const US = 3468;

function match(over: Omit<Partial<OfficialMatch>, "red" | "blue"> & { red?: Partial<OfficialAlliance>; blue?: Partial<OfficialAlliance> } = {}): OfficialMatch {
  const { red, blue, ...rest } = over;
  return {
    eventCode: "EVT",
    matchType: "Qualification",
    matchNumber: 1,
    played: false,
    startTime: null,
    red: { teams: [US, 111], score: null, penaltyPoints: null, ...red },
    blue: { teams: [222, 333], score: null, penaltyPoints: null, ...blue },
    ...rest,
  };
}

describe("parseEventTime", () => {
  it("reads a bare wall time in the event's timezone (standard and daylight time)", () => {
    expect(parseEventTime("2025-11-08T09:00:00", "America/Los_Angeles")).toBe(Date.UTC(2025, 10, 8, 17, 0, 0)); // PST, UTC-8
    expect(parseEventTime("2025-07-01T09:00:00", "America/Los_Angeles")).toBe(Date.UTC(2025, 6, 1, 16, 0, 0)); // PDT, UTC-7
    expect(parseEventTime("2025-11-08T09:00:00", "America/New_York")).toBe(Date.UTC(2025, 10, 8, 14, 0, 0)); // EST, UTC-5
    expect(parseEventTime("2025-11-08T09:00:00", "UTC")).toBe(Date.UTC(2025, 10, 8, 9, 0, 0));
  });

  it("is right across a daylight-saving change", () => {
    // 2025-03-09 02:00 LA springs forward; 10:00 that morning is already PDT (UTC-7).
    expect(parseEventTime("2025-03-09T10:00:00", "America/Los_Angeles")).toBe(Date.UTC(2025, 2, 9, 17, 0, 0));
    expect(parseEventTime("2025-03-09T01:00:00", "America/Los_Angeles")).toBe(Date.UTC(2025, 2, 9, 9, 0, 0)); // still PST
  });

  it("takes a string that carries its own offset as written", () => {
    expect(parseEventTime("2025-11-08T09:00:00-08:00", "UTC")).toBe(Date.UTC(2025, 10, 8, 17, 0, 0));
    expect(parseEventTime("2025-11-08T09:00:00Z", "America/Los_Angeles")).toBe(Date.UTC(2025, 10, 8, 9, 0, 0));
    expect(parseEventTime("2025-11-08T09:00:00+0530", null)).toBe(Date.UTC(2025, 10, 8, 3, 30, 0));
  });

  it("falls back to the viewer's own timezone without (or with a bad) event timezone", () => {
    const local = new Date(2025, 10, 8, 9, 0, 0).getTime();
    expect(parseEventTime("2025-11-08T09:00:00", null)).toBe(local);
    expect(parseEventTime("2025-11-08T09:00:00", "Not/AZone")).toBe(local);
  });

  it("accepts fractional seconds and a space separator; returns null for junk", () => {
    expect(parseEventTime("2025-11-08 09:00:00.250", "UTC")).toBe(Date.UTC(2025, 10, 8, 9, 0, 0));
    expect(parseEventTime(null, "UTC")).toBeNull();
    expect(parseEventTime("", "UTC")).toBeNull();
    expect(parseEventTime("soon", "UTC")).toBeNull();
  });

  it("tzOffsetMs reports the zone's offset", () => {
    expect(tzOffsetMs(Date.UTC(2025, 10, 8, 12), "America/Los_Angeles")).toBe(-8 * 3_600_000);
    expect(tzOffsetMs(Date.UTC(2025, 6, 1, 12), "America/Los_Angeles")).toBe(-7 * 3_600_000);
    expect(tzOffsetMs(Date.UTC(2025, 6, 1, 12), "UTC")).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("scales from seconds to days and says Now when it has arrived", () => {
    expect(formatCountdown(0)).toBe("Now");
    expect(formatCountdown(-5000)).toBe("Now");
    expect(formatCountdown(45_000)).toBe("0m 45s");
    expect(formatCountdown(12 * 60_000 + 5_000)).toBe("12m 05s");
    expect(formatCountdown(72 * 60_000)).toBe("1h 12m");
    expect(formatCountdown(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d 4h");
  });
});

describe("timeAgo", () => {
  const now = 1_000_000_000_000;
  it("reads naturally from seconds to days", () => {
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now - 44_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2 d ago");
  });
  it("treats a future timestamp as just now", () => {
    expect(timeAgo(now + 60_000, now)).toBe("just now");
  });
});

describe("buildOurMatches", () => {
  const matches = [
    match({ matchNumber: 12, blue: { teams: [US, 444] }, red: { teams: [555, 666] }, played: true }), // played, but no scores yet
    match({ matchNumber: 3, played: true, red: { teams: [US, 111], score: 85, penaltyPoints: 10 }, blue: { teams: [222, 333], score: 70, penaltyPoints: 0 } }),
    match({ matchNumber: 20, startTime: "2025-11-08T10:30:00" }),
    match({ matchNumber: 5, red: { teams: [1, 2] }, blue: { teams: [3, 4] } }), // not ours
    match({ matchType: "Playoff", matchNumber: 1 }),
  ];
  const ours = buildOurMatches(matches, US, "America/Los_Angeles");

  it("keeps only our matches, in play order", () => {
    expect(ours.map((m) => m.label)).toEqual(["Q3", "Q12", "Q20", "F1"]);
  });

  it("works out alliance color, partner, and opponents", () => {
    const q3 = ours.find((m) => m.label === "Q3")!;
    expect(q3.alliance).toBe("red");
    expect(q3.partner).toBe(111);
    expect(q3.opponents).toEqual([222, 333]);
    const q12 = ours.find((m) => m.label === "Q12")!;
    expect(q12.alliance).toBe("blue");
    expect(q12.partner).toBe(444);
  });

  it("scores a played match from our side, as FIRST reports it", () => {
    const q3 = ours.find((m) => m.label === "Q3")!;
    expect(q3).toMatchObject({ played: true, ourScore: 85, theirScore: 70, result: "W" });
  });

  it("has no result for a played match without scores, or an unplayed one", () => {
    expect(ours.find((m) => m.label === "Q12")!.result).toBeNull();
    expect(ours.find((m) => m.label === "Q20")!.result).toBeNull();
  });

  it("turns the scheduled time into an instant in the event's timezone", () => {
    expect(ours.find((m) => m.label === "Q20")!.startMs).toBe(Date.UTC(2025, 10, 8, 18, 30, 0));
    expect(ours.find((m) => m.label === "Q3")!.startMs).toBeNull();
  });

  it("is empty without our team number", () => {
    expect(buildOurMatches(matches, null, null)).toEqual([]);
  });

  it("scores losses and ties", () => {
    const m = buildOurMatches(
      [
        match({ matchNumber: 1, played: true, red: { teams: [US, 1], score: 40 }, blue: { teams: [2, 3], score: 60 } }),
        match({ matchNumber: 2, played: true, red: { teams: [US, 1], score: 50 }, blue: { teams: [2, 3], score: 50 } }),
      ],
      US,
      null
    );
    expect(m.map((x) => x.result)).toEqual(["L", "T"]);
  });
});

describe("next / upcoming / recent / record", () => {
  const ours = buildOurMatches(
    [
      match({ matchNumber: 1, played: true, red: { teams: [US, 1], score: 90 }, blue: { teams: [2, 3], score: 80 } }),
      match({ matchNumber: 2, played: true, red: { teams: [US, 1], score: 20 }, blue: { teams: [2, 3], score: 80 } }),
      match({ matchNumber: 3 }),
      match({ matchNumber: 4 }),
      match({ matchType: "Playoff", matchNumber: 1 }),
    ],
    US,
    null
  );

  it("the next match is the first unplayed one in play order", () => {
    expect(nextOurMatch(ours)?.label).toBe("Q3");
    expect(nextOurMatch(ours.filter((m) => m.played))).toBeNull();
  });

  it("lists upcoming matches and recent results (most recent first)", () => {
    expect(upcomingOurMatches(ours, 2).map((m) => m.label)).toEqual(["Q3", "Q4"]);
    expect(recentOurResults(ours, 5).map((m) => m.label)).toEqual(["Q2", "Q1"]);
    expect(recentOurResults(ours, 1).map((m) => m.label)).toEqual(["Q2"]);
  });

  it("prefers the official record, else counts our played qualification matches", () => {
    const ranking: FtcRanking = { teamNumber: US, rank: 4, wins: 5, losses: 2, ties: 1, matchesPlayed: 8, rankingPoints: 1.2 };
    expect(ourRecord(ranking, ours)).toEqual({ wins: 5, losses: 2, ties: 1 });
    expect(ourRecord(null, ours)).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(ourRecord(null, [])).toBeNull();
    expect(formatRecord({ wins: 5, losses: 2, ties: 1 })).toBe("5-2-1");
    expect(formatRecord(null)).toBe("-");
  });
});

describe("matchShareText", () => {
  const played = match({ matchNumber: 12, played: true, red: { teams: [US, 1], score: 85 }, blue: { teams: [2, 3], score: 70 } });

  it("formats `Q12: Red 85 - Blue 70 (W)` from our point of view", () => {
    expect(matchShareText(played, US)).toBe("Q12: Red 85 - Blue 70 (W)");
    expect(matchShareText(played, 2)).toBe("Q12: Red 85 - Blue 70 (L)");
  });

  it("omits the result when we weren't in the match or the team is unknown", () => {
    expect(matchShareText(played, 999)).toBe("Q12: Red 85 - Blue 70");
    expect(matchShareText(played, null)).toBe("Q12: Red 85 - Blue 70");
  });

  it("is a tie when scores are level, and null for a match without a result", () => {
    expect(matchShareText(match({ played: true, red: { teams: [US, 1], score: 60 }, blue: { teams: [2, 3], score: 60 } }), US)).toBe("Q1: Red 60 - Blue 60 (T)");
    expect(matchShareText(match(), US)).toBeNull();
  });

  it("labels finals with F", () => {
    expect(matchShareText(match({ matchType: "Playoff", matchNumber: 2, played: true, red: { teams: [US, 1], score: 1 }, blue: { teams: [2, 3], score: 0 } }), US)).toBe("F2: Red 1 - Blue 0 (W)");
  });
});

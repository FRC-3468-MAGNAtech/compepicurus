import { describe, expect, it } from "vitest";
import { getDifficulty } from "@/lib/difficulty";
import { BULK_COLUMNS, bulkTemplateCsv, splitBulkText, summarizeBulk, validateBulk } from "./bulk";
import { validateEventForm } from "./event-form";
import { decideMatchWrite, generateManualEventCode, libraryMatchId, normalizeEventCode, originOf, parseMatchType, validateEventCode } from "./ids";
import {
  buildManualMatchDoc,
  buildManualMatchFields,
  emptyRawMatch,
  manualMatchId,
  matchToRaw,
  matchWarnings,
  scoreOutlier,
  validateRawMatch,
  type RawMatch,
  type ValidMatch,
} from "./manual-match";
import { formatTime, parseTimeInput, validateVideoWindow } from "./time";
import { canonicalYouTubeUrl, parseYouTubeUrl } from "./youtube-url";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeUrl", () => {
  it("reads every common link form", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/v/${ID}`,
      `http://www.youtube.com/watch?v=${ID}`,
      `www.youtube.com/watch?v=${ID}`,
      `youtu.be/${ID}`,
      `  https://youtu.be/${ID}  `,
      ID,
    ]) {
      expect(parseYouTubeUrl(url)?.videoId, url).toBe(ID);
    }
  });

  it("ignores extra query parameters like si, feature, and list, and parameter order", () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?si=AbCdEf123`)?.videoId).toBe(ID);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?feature=share&v=${ID}&list=PL123&si=xyz`)?.videoId).toBe(ID);
    expect(parseYouTubeUrl(`https://www.youtube.com/embed/${ID}?si=abc&rel=0`)?.videoId).toBe(ID);
  });

  it("pre-fills the start time from t= in each form", () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=90`)?.startSec).toBe(90);
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=90s`)?.startSec).toBe(90);
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?si=abc&t=1m30s`)?.startSec).toBe(90);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`)?.startSec).toBe(3723);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&start=45`)?.startSec).toBe(45);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}#t=2m`)?.startSec).toBe(120);
    expect(parseYouTubeUrl(`https://youtu.be/${ID}`)?.startSec).toBeNull();
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=banana`)?.startSec).toBeNull();
  });

  it("rejects other hosts, bad ids, and non-links", () => {
    for (const bad of [
      "",
      "   ",
      "hello",
      `https://evil.example.com/watch?v=${ID}`,
      `https://youtube.com.evil.example/watch?v=${ID}`,
      `https://notyoutube.com/watch?v=${ID}`,
      `javascript:alert(1)`,
      `ftp://youtu.be/${ID}`,
      `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/watch`,
      `https://www.youtube.com/channel/${ID}`,
      `https://youtu.be/`,
      `https://www.youtube.com/watch?v=${ID}extra`,
    ]) {
      expect(parseYouTubeUrl(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("has one canonical form", () => {
    expect(canonicalYouTubeUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(parseYouTubeUrl(canonicalYouTubeUrl(ID))?.videoId).toBe(ID);
  });
});

describe("time input", () => {
  it("parses seconds, m:ss, h:mm:ss, and the YouTube forms", () => {
    expect(parseTimeInput("90")).toBe(90);
    expect(parseTimeInput("0")).toBe(0);
    expect(parseTimeInput("90.5")).toBe(90.5);
    expect(parseTimeInput("1:30")).toBe(90);
    expect(parseTimeInput("01:30")).toBe(90);
    expect(parseTimeInput("1:02:30")).toBe(3750);
    expect(parseTimeInput("0:05")).toBe(5);
    expect(parseTimeInput("125:00")).toBe(7500);
    expect(parseTimeInput(" 2m ")).toBe(120);
    expect(parseTimeInput("1m30s")).toBe(90);
    expect(parseTimeInput("90s")).toBe(90);
    expect(parseTimeInput("1h")).toBe(3600);
  });

  it("rejects junk, negatives, and out-of-range parts", () => {
    for (const bad of ["", "  ", "abc", "-5", "1:75", "1:60", "1:02:75", "1:75:00", "1::30", ":30", "1:2:3:4", "1e3", "90 sec", "99999999"]) {
      expect(parseTimeInput(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("formats back to m:ss or h:mm:ss", () => {
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(3750)).toBe("1:02:30");
    expect(formatTime(89.6)).toBe("1:30");
    expect(parseTimeInput(formatTime(3750))).toBe(3750);
  });

  it("requires the clip to end after it starts", () => {
    expect(validateVideoWindow(10, 160)).toBeNull();
    expect(validateVideoWindow(0, 1)).toBeNull();
    expect(validateVideoWindow(160, 160)).toBeTruthy();
    expect(validateVideoWindow(200, 100)).toBeTruthy();
    expect(validateVideoWindow(-1, 100)).toBeTruthy();
  });
});

describe("match ids, types, and origin", () => {
  it("keeps the `${eventCode}_${type}${number}` id format", () => {
    expect(libraryMatchId("USWABON1", "Qualification", 12)).toBe("USWABON1_Q12");
    expect(libraryMatchId("MAN-KITCHEN", "Practice", 3)).toBe("MAN-KITCHEN_P3");
    expect(libraryMatchId("MAN-KITCHEN", "Playoff", 1)).toBe("MAN-KITCHEN_F1");
  });

  it("reads match types", () => {
    expect(parseMatchType("q")).toBe("Qualification");
    expect(parseMatchType(" P ")).toBe("Practice");
    expect(parseMatchType("F")).toBe("Playoff");
    expect(parseMatchType("Finals")).toBe("Playoff");
    expect(parseMatchType("Qualification")).toBe("Qualification");
    expect(parseMatchType("X")).toBeNull();
    expect(parseMatchType("")).toBeNull();
  });

  it("treats a doc with no origin as an API match", () => {
    expect(originOf({})).toBe("api");
    expect(originOf(null)).toBe("api");
    expect(originOf({ origin: "api" })).toBe("api");
    expect(originOf({ origin: "manual" })).toBe("manual");
    expect(originOf({ origin: "weird" })).toBe("api");
  });

  it("never lets one origin write over the other, and lets each update its own", () => {
    expect(decideMatchWrite(null, "manual")).toBe("create");
    expect(decideMatchWrite(null, "api")).toBe("create");
    expect(decideMatchWrite({ origin: "manual" }, "manual")).toBe("update");
    expect(decideMatchWrite({ origin: "api" }, "api")).toBe("update");
    expect(decideMatchWrite({}, "api")).toBe("update"); // a pre-P15 doc is API
    expect(decideMatchWrite({ origin: "api" }, "manual")).toBe("skip-other-origin");
    expect(decideMatchWrite({}, "manual")).toBe("skip-other-origin");
    expect(decideMatchWrite({ origin: "manual" }, "api")).toBe("skip-other-origin");
  });
});

describe("event codes", () => {
  it("generates MAN- plus a short slug, never colliding", () => {
    expect(generateManualEventCode("Kitchen Table Scrimmage", new Set())).toBe("MAN-KITCHENTAB");
    expect(generateManualEventCode("Kitchen Table Scrimmage", new Set(["MAN-KITCHENTAB"]))).toBe("MAN-KITCHENTAB-2");
    expect(generateManualEventCode("Kitchen Table Scrimmage", new Set(["man-kitchentab", "MAN-KITCHENTAB-2"]))).toBe("MAN-KITCHENTAB-3");
    expect(generateManualEventCode("!!!", new Set())).toBe("MAN-EVENT");
    expect(generateManualEventCode("a", new Set())).toMatch(/^MAN-A$/);
    // A generated code can never equal a real FTC code such as USWABON1 (it always has the MAN- prefix and a hyphen).
    expect(generateManualEventCode("USWABON1", new Set(["USWABON1"]))).toBe("MAN-USWABON1");
  });

  it("generated codes are valid, and fit the limits even when suffixed", () => {
    const code = generateManualEventCode("A Very Long Event Name Indeed", new Set(["MAN-AVERYLONGE"]));
    expect(validateEventCode(code, new Set()).ok).toBe(true);
  });

  it("normalizes a typed code", () => {
    expect(normalizeEventCode(" my event 1 ")).toBe("MY-EVENT-1");
    expect(normalizeEventCode("us/wa*bon")).toBe("USWABON");
    expect(normalizeEventCode("--x--")).toBe("X");
  });

  it("rejects a typed code that is already used (any case), too short or long, or has an underscore", () => {
    expect(validateEventCode("scrim-1", new Set())).toEqual({ ok: true, code: "SCRIM-1" });
    expect(validateEventCode("uswabon1", new Set(["USWABON1"])).ok).toBe(false);
    expect(validateEventCode("USWABON1", new Set(["uswabon1"])).ok).toBe(false);
    expect(validateEventCode("ab", new Set()).ok).toBe(false);
    expect(validateEventCode("x".repeat(25), new Set()).ok).toBe(false);
    expect(validateEventCode("my_event", new Set()).ok).toBe(false);
  });
});

const raw = (over: Partial<RawMatch> = {}): RawMatch => ({
  ...emptyRawMatch(),
  matchType: "Q",
  matchNumber: "7",
  red1: "254",
  red2: "971",
  blue1: "118",
  blue2: "1114",
  redScore: "142",
  blueScore: "98",
  redPenalty: "6",
  bluePenalty: "0",
  youtubeUrl: `https://youtu.be/${ID}?si=abc`,
  start: "1:10",
  end: "3:40",
  notes: "  nice match ",
  ...over,
});

describe("validateRawMatch", () => {
  it("accepts a full row and normalizes it", () => {
    const r = validateRawMatch(raw());
    expect(r.ok).toBe(true);
    expect(r.match).toEqual({
      matchType: "Qualification",
      matchNumber: 7,
      red: { teams: [254, 971], score: 142, penaltyPoints: 6 },
      blue: { teams: [118, 1114], score: 98, penaltyPoints: 0 },
      video: { youtubeUrl: canonicalYouTubeUrl(ID), startSec: 70, endSec: 220 },
      notes: "nice match",
    });
  });

  it("takes the start time from t= when the start box is empty, otherwise leaves it blank (the beginning)", () => {
    expect(validateRawMatch(raw({ youtubeUrl: `https://youtu.be/${ID}?t=95`, start: "" })).match?.video?.startSec).toBe(95);
    expect(validateRawMatch(raw({ start: "" })).match?.video?.startSec).toBeNull();
    expect(validateRawMatch(raw({ youtubeUrl: `https://youtu.be/${ID}?t=95`, start: "10" })).match?.video?.startSec).toBe(10);
  });

  it("allows a match with no video at all", () => {
    const r = validateRawMatch(raw({ youtubeUrl: "", start: "", end: "" }));
    expect(r.ok).toBe(true);
    expect(r.match?.video).toBeNull();
  });

  it("uses the event's default video when the row has none", () => {
    const r = validateRawMatch(raw({ youtubeUrl: "" }), { defaultVideoUrl: `https://youtu.be/${ID}` });
    expect(r.match?.video).toEqual({ youtubeUrl: canonicalYouTubeUrl(ID), startSec: 70, endSec: 220 });
    // ...and the row's own link wins over the default.
    const other = "abcdefghijk";
    expect(validateRawMatch(raw({ youtubeUrl: other }), { defaultVideoUrl: `https://youtu.be/${ID}` }).match?.video?.youtubeUrl).toBe(canonicalYouTubeUrl(other));
  });

  it("validates team numbers: 1-5 digits, whole, all four distinct", () => {
    for (const bad of ["", "0", "abc", "123456", "12.5", "-4", " "]) {
      expect(validateRawMatch(raw({ red1: bad })).errors.red1, JSON.stringify(bad)).toBeTruthy();
    }
    expect(validateRawMatch(raw({ red1: "1", red2: "99999" })).ok).toBe(true);
    const dupe = validateRawMatch(raw({ blue1: "254" }));
    expect(dupe.ok).toBe(false);
    expect(dupe.errors.blue1).toContain("254");
    expect(validateRawMatch(raw({ red2: "254" })).errors.red2).toBeTruthy();
  });

  it("validates scores and penalty points as whole numbers, with penalty never above its own alliance's score", () => {
    expect(validateRawMatch(raw({ redScore: "-1" })).errors.redScore).toBeTruthy();
    expect(validateRawMatch(raw({ redScore: "12.5" })).errors.redScore).toBeTruthy();
    expect(validateRawMatch(raw({ blueScore: "" })).errors.blueScore).toBeTruthy();
    expect(validateRawMatch(raw({ redPenalty: "-3" })).errors.redPenalty).toBeTruthy();
    expect(validateRawMatch(raw({ redScore: "10", redPenalty: "11" })).errors.redPenalty).toBeTruthy();
    expect(validateRawMatch(raw({ blueScore: "5", bluePenalty: "6" })).errors.bluePenalty).toBeTruthy();
    expect(validateRawMatch(raw({ redScore: "10", redPenalty: "10" })).ok).toBe(true); // equal is fine
    // Red's penalty is judged against red's score, not blue's.
    expect(validateRawMatch(raw({ redScore: "200", redPenalty: "150", blueScore: "10" })).ok).toBe(true);
  });

  it("treats a blank penalty as 0", () => {
    const r = validateRawMatch(raw({ redPenalty: "", bluePenalty: "" }));
    expect(r.match?.red.penaltyPoints).toBe(0);
    expect(r.match?.blue.penaltyPoints).toBe(0);
  });

  it("validates match type and number", () => {
    expect(validateRawMatch(raw({ matchType: "Z" })).errors.matchType).toBeTruthy();
    expect(validateRawMatch(raw({ matchType: "" })).errors.matchType).toBeTruthy();
    expect(validateRawMatch(raw({ matchType: "" }), { defaultMatchType: "Practice" }).match?.matchType).toBe("Practice");
    for (const bad of ["", "0", "-1", "1.5", "abc", "10000"]) {
      expect(validateRawMatch(raw({ matchNumber: bad })).errors.matchNumber, bad).toBeTruthy();
    }
  });

  it("validates the video: a real YouTube link, parseable times, start before end", () => {
    expect(validateRawMatch(raw({ youtubeUrl: "https://vimeo.com/123" })).errors.youtubeUrl).toBeTruthy();
    expect(validateRawMatch(raw({ start: "abc" })).errors.start).toBeTruthy();
    expect(validateRawMatch(raw({ end: "later" })).errors.end).toBeTruthy();
    expect(validateRawMatch(raw({ start: "3:00", end: "2:00" })).errors.end).toBeTruthy();
    expect(validateRawMatch(raw({ start: "90", end: "90" })).errors.end).toBeTruthy();
  });

  it("limits notes", () => {
    expect(validateRawMatch(raw({ notes: "x".repeat(501) })).errors.notes).toBeTruthy();
  });

  it("reports every problem at once, not just the first", () => {
    const r = validateRawMatch(raw({ red1: "x", blueScore: "", end: "later" }));
    expect(Object.keys(r.errors).sort()).toEqual(["blueScore", "end", "red1"]);
  });
});

// FIX3: start and end are both optional — blank, start only, end only, or both.
describe("optional start and end times", () => {
  const link = `https://youtu.be/${ID}`;
  const video = (over: Partial<RawMatch>) => validateRawMatch(raw({ youtubeUrl: link, start: "", end: "", ...over }));

  it("both blank is valid: the match plays from the beginning to the end of the video", () => {
    const r = video({});
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.match?.video).toEqual({ youtubeUrl: canonicalYouTubeUrl(ID), startSec: null, endSec: null });
  });

  it("start only is valid: plays from the start to the end of the video", () => {
    const r = video({ start: "1:10" });
    expect(r.ok).toBe(true);
    expect(r.match?.video).toEqual({ youtubeUrl: canonicalYouTubeUrl(ID), startSec: 70, endSec: null });
  });

  it("end only is valid: plays from the beginning to the end time", () => {
    const r = video({ end: "3:40" });
    expect(r.ok).toBe(true);
    expect(r.match?.video).toEqual({ youtubeUrl: canonicalYouTubeUrl(ID), startSec: null, endSec: 220 });
  });

  it("both given is valid, and must have the end after the start", () => {
    expect(video({ start: "1:10", end: "3:40" }).match?.video).toMatchObject({ startSec: 70, endSec: 220 });
    expect(video({ start: "3:00", end: "2:00" }).errors.end).toBeTruthy();
    expect(video({ start: "90", end: "90" }).errors.end).toBeTruthy();
  });

  it("only checks start < end when both are present: an end on its own just has to be after the beginning", () => {
    expect(video({ end: "30" }).ok).toBe(true);
    expect(video({ end: "0" }).errors.end).toBeTruthy(); // 0 is not after the beginning
    expect(video({ start: "9999" }).ok).toBe(true); // a lone start can't be compared with anything
  });

  it("still rejects a time that can't be read — blank is fine, junk is not", () => {
    expect(video({ start: "abc" }).errors.start).toBeTruthy();
    expect(video({ end: "later" }).errors.end).toBeTruthy();
    expect(video({ start: "  ", end: " " }).ok).toBe(true); // whitespace counts as blank
  });

  it("a t= in the link still pre-fills a blank start, and a typed start wins", () => {
    expect(video({ youtubeUrl: `${link}?t=95` }).match?.video?.startSec).toBe(95);
    expect(video({ youtubeUrl: `${link}?t=95`, start: "10" }).match?.video?.startSec).toBe(10);
    expect(video({ youtubeUrl: `${link}?t=95`, end: "3:00" }).match?.video).toMatchObject({ startSec: 95, endSec: 180 });
  });

  it("with no link at all the times are irrelevant", () => {
    expect(validateRawMatch(raw({ youtubeUrl: "", start: "abc", end: "xyz" })).match?.video).toBeNull();
  });

  it("round-trips through the form strings in every combination", () => {
    for (const times of [{}, { start: "1:10" }, { end: "3:40" }, { start: "1:10", end: "3:40" }]) {
      const first = video(times).match!;
      const doc = buildManualMatchFields(first, { eventCode: "MAN-T", eventName: "T", seasonId: "biobuzz" });
      expect(validateRawMatch(matchToRaw(doc)).match).toEqual(first);
    }
  });

  it("no longer warns about a clip it cannot measure, but still warns about a long measured one", () => {
    const event = { eventCode: "MAN-T" };
    const ctx = { event, existingIds: new Set<string>(), siblings: [] };
    expect(matchWarnings(video({}).match!, ctx)).toEqual([]);
    expect(matchWarnings(video({ start: "0:10" }).match!, ctx)).toEqual([]);
    expect(matchWarnings(video({ end: "30:00" }).match!, ctx).some((w) => w.includes("30:00"))).toBe(true);
  });
});

describe("optional times in CSV and pasted rows", () => {
  const HDR = BULK_COLUMNS.join(",");
  const rowWith = (start: string, end: string, url = `https://youtu.be/${ID}`) => `Q,1,254,971,118,1114,142,98,6,0,${url},${start},${end},`;
  const preview = (row: string) => validateBulk({ text: `${HDR}\n${row}`, event: { eventCode: "MAN-T" }, defaults: { matchType: null, youtubeUrl: "" }, existing: new Map() });

  it("blank startSec and endSec are not errors — in any combination", () => {
    for (const [start, end, expected] of [
      ["", "", { startSec: null, endSec: null }],
      ["1:10", "", { startSec: 70, endSec: null }],
      ["", "3:40", { startSec: null, endSec: 220 }],
      ["1:10", "3:40", { startSec: 70, endSec: 220 }],
    ] as const) {
      const result = preview(rowWith(start, end));
      expect(result.rows[0].errors, `${start}|${end}`).toEqual([]);
      expect(result.rows[0].match?.video).toMatchObject(expected);
      expect(summarizeBulk(result)).toMatchObject({ valid: 1, errors: 0, creates: 1 });
    }
  });

  it("omitting the startSec and endSec columns entirely is fine too", () => {
    const text = "matchType,matchNumber,red1,red2,blue1,blue2,redScore,blueScore,youtubeUrl\nQ,1,254,971,118,1114,142,98," + `https://youtu.be/${ID}`;
    const result = validateBulk({ text, event: { eventCode: "MAN-T" }, defaults: { matchType: null, youtubeUrl: "" }, existing: new Map() });
    expect(result.columnErrors).toEqual([]);
    expect(result.rows[0].match?.video).toMatchObject({ startSec: null, endSec: null });
  });

  it("works the same for text pasted from a spreadsheet (tab-separated, trailing cells empty)", () => {
    const tsv = ["Q", "1", "254", "971", "118", "1114", "142", "98", "6", "0", `https://youtu.be/${ID}`, "", "", ""].join("\t");
    const result = validateBulk({ text: tsv, event: { eventCode: "MAN-T" }, defaults: { matchType: null, youtubeUrl: "" }, existing: new Map() });
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].match?.video).toMatchObject({ startSec: null, endSec: null });
  });

  it("an event default video with blank times works per row, too", () => {
    const text = `${HDR}\n${rowWith("", "", "")}`;
    const result = validateBulk({ text, event: { eventCode: "MAN-T" }, defaults: { matchType: null, youtubeUrl: `https://youtu.be/${ID}` }, existing: new Map() });
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].match?.video).toEqual({ youtubeUrl: canonicalYouTubeUrl(ID), startSec: null, endSec: null });
  });

  it("still flags a time that can't be read, or an end before the start when both are given", () => {
    expect(preview(rowWith("abc", "")).rows[0].errors.join(" ")).toMatch(/Start/);
    expect(preview(rowWith("", "later")).rows[0].errors.join(" ")).toMatch(/End/);
    expect(preview(rowWith("3:00", "2:00")).rows[0].errors.join(" ")).toMatch(/End/);
  });
});

describe("difficulty comes from the typed scores", () => {
  it("is computed per alliance with the shared getDifficulty, and again on every edit", () => {
    const event = { eventCode: "MAN-T", eventName: "T", seasonId: "biobuzz" };
    const first = buildManualMatchFields(validateRawMatch(raw({ redScore: "30", blueScore: "95", redPenalty: "0" })).match!, event);
    expect(first.alliances.red.difficulty).toBe(getDifficulty(30));
    expect(first.alliances.red.difficulty).toBe("easy");
    expect(first.alliances.blue.difficulty).toBe("hard");
    // Editing the score to something else gives a different tier — nothing is cached.
    const edited = buildManualMatchFields(validateRawMatch(raw({ redScore: "60", blueScore: "40", redPenalty: "0" })).match!, event);
    expect(edited.alliances.red.difficulty).toBe("medium");
    expect(edited.alliances.blue.difficulty).toBe("easy");
    // The boundaries from lib/difficulty.ts.
    for (const [score, tier] of [[40, "easy"], [41, "medium"], [79, "medium"], [80, "hard"]] as const) {
      expect(buildManualMatchFields(validateRawMatch(raw({ redScore: String(score), redPenalty: "0" })).match!, event).alliances.red.difficulty).toBe(tier);
    }
  });

  it("builds the library match fields in the shape practice flows read", () => {
    const m = validateRawMatch(raw()).match!;
    const doc = buildManualMatchFields(m, { eventCode: "MAN-T", eventName: "Test Event", seasonId: "biobuzz" });
    expect(doc).toMatchObject({
      seasonId: "biobuzz",
      eventCode: "MAN-T",
      eventName: "Test Event",
      matchType: "Qualification",
      matchNumber: 7,
      alliances: { red: { teams: [254, 971], score: 142, penaltyPoints: 6 }, blue: { teams: [118, 1114], score: 98, penaltyPoints: 0 } },
    });
    expect(manualMatchId({ eventCode: "MAN-T" }, m)).toBe("MAN-T_Q7");
  });

  it("round-trips through the form strings", () => {
    const m = validateRawMatch(raw()).match!;
    const doc = buildManualMatchFields(m, { eventCode: "MAN-T", eventName: "T", seasonId: "biobuzz" });
    const again = validateRawMatch(matchToRaw({ ...doc, matchType: doc.matchType })).match;
    expect(again).toEqual(m);
  });
});

describe("sanity warnings", () => {
  const event = { eventCode: "MAN-T" };
  const sibling = (n: number, red: number, blue: number): ValidMatch => ({
    matchType: "Qualification",
    matchNumber: n,
    red: { teams: [1, 2], score: red, penaltyPoints: 0 },
    blue: { teams: [3, 4], score: blue, penaltyPoints: 0 },
    video: null,
    notes: "",
  });
  const siblings = [sibling(1, 100, 90), sibling(2, 110, 95), sibling(3, 105, 98), sibling(4, 92, 120)];
  const match = (red: number, blue: number, n = 9): ValidMatch => ({ ...sibling(n, red, blue) });

  it("flags a score far from the event's other matches, but not an ordinary one", () => {
    expect(scoreOutlier(105, [100, 90, 110, 95, 105, 98])).toBeNull();
    const high = scoreOutlier(480, [100, 90, 110, 95, 105, 98]);
    expect(high).not.toBeNull();
    expect(scoreOutlier(0, [100, 90, 110, 95, 105, 98])).not.toBeNull();
    expect(matchWarnings(match(480, 100), { event, existingIds: new Set(), siblings }).some((w) => w.includes("Red score 480"))).toBe(true);
    expect(matchWarnings(match(104, 99), { event, existingIds: new Set(), siblings })).toEqual([]);
  });

  it("says nothing about outliers with too few other matches, or when every score is low", () => {
    expect(scoreOutlier(500, [10, 20, 30])).toBeNull();
    expect(scoreOutlier(35, [10, 12, 14, 11, 13, 9])).toBeNull(); // the margin has a floor
  });

  it("warns when the same match number already exists (saving replaces it)", () => {
    const warnings = matchWarnings(match(100, 90, 2), { event, existingIds: new Set(["MAN-T_Q2"]), siblings });
    expect(warnings.some((w) => w.includes("Q2 already exists"))).toBe(true);
  });

  it("doesn't compare a match against its own old values when editing", () => {
    // Editing Q4 (blue 120): its own previous scores aren't part of 'the others'.
    const warnings = matchWarnings(match(100, 120, 4), { event, existingIds: new Set(["MAN-T_Q4"]), siblings });
    expect(warnings.some((w) => w.includes("far from"))).toBe(false);
  });

  it("warns about a clip that is far longer than a match", () => {
    const long: ValidMatch = { ...match(100, 90), video: { youtubeUrl: canonicalYouTubeUrl(ID), startSec: 0, endSec: 1800 } };
    expect(matchWarnings(long, { event, existingIds: new Set(), siblings }).some((w) => w.includes("30:00"))).toBe(true);
  });
});

const TARGET = { eventCode: "MAN-T" };
const noDefaults = { matchType: null, youtubeUrl: "" };
const HEADER = BULK_COLUMNS.join(",");
const bulk = (text: string, over: { defaults?: { matchType: "Practice" | "Qualification" | "Playoff" | null; youtubeUrl: string }; existing?: Map<string, { origin?: unknown }> } = {}) =>
  validateBulk({ text, event: TARGET, defaults: over.defaults ?? noDefaults, existing: over.existing ?? new Map() });

describe("bulk entry", () => {
  const goodRow = (n: number) => `Q,${n},254,971,118,1114,142,98,6,0,,,,`;

  it("provides a template with exactly the documented columns", () => {
    expect(bulkTemplateCsv().split(/\r?\n/)[0]).toBe("matchType,matchNumber,red1,red2,blue1,blue2,redScore,blueScore,redPenalty,bluePenalty,youtubeUrl,startSec,endSec,notes");
    // The template's own example rows validate.
    const result = bulk(bulkTemplateCsv());
    expect(result.columnErrors).toEqual([]);
    expect(summarizeBulk(result)).toMatchObject({ total: 2, valid: 2, errors: 0, creates: 2 });
  });

  it("validates a CSV with a header and no event column — every row gets the target event", () => {
    const result = bulk(`${HEADER}\n${goodRow(1)}\n${goodRow(2)}`);
    expect(result.hasHeader).toBe(true);
    expect(summarizeBulk(result)).toMatchObject({ total: 2, valid: 2, creates: 2, updates: 0 });
    expect(result.rows.map((r) => r.id)).toEqual(["MAN-T_Q1", "MAN-T_Q2"]);
  });

  it("accepts rows pasted from a spreadsheet (tab-separated), with or without the header", () => {
    const tsv = (cells: string[]) => cells.join("\t");
    const row = tsv(["Q", "1", "254", "971", "118", "1114", "142", "98", "6", "0", "", "", "", ""]);
    const withHeader = bulk(`${BULK_COLUMNS.join("\t")}\n${row}`);
    expect(summarizeBulk(withHeader)).toMatchObject({ total: 1, valid: 1 });
    const headerless = bulk(row);
    expect(headerless.hasHeader).toBe(false);
    expect(summarizeBulk(headerless)).toMatchObject({ total: 1, valid: 1 });
    expect(splitBulkText(`a\tb\n"c\td"\te`)).toEqual([["a", "b"], ["c\td", "e"]]);
  });

  it("maps columns by header name in any order, ignoring case and spacing, and extra columns", () => {
    const text = ["Red Score,Blue Score,Match Number,Match Type,Red 1,Red 2,Blue 1,Blue 2,Scout,URL", "142,98,5,Q,254,971,118,1114,somebody,"].join("\n");
    const result = bulk(text);
    expect(result.columnErrors).toEqual([]);
    expect(result.rows[0].match).toMatchObject({ matchNumber: 5, red: { score: 142 }, blue: { score: 98 } });
  });

  it("reports missing columns instead of importing", () => {
    const result = bulk("matchType,matchNumber,red1,red2,blue1,blue2,redScore\nQ,1,254,971,118,1114,142");
    expect(result.columnErrors.some((e) => e.includes("blueScore"))).toBe(true);
    expect(result.rows).toEqual([]);
    expect(bulk("").columnErrors).toHaveLength(1);
  });

  it("applies the event defaults: match type, video, and penalty 0 when blank", () => {
    const text = "matchNumber,red1,red2,blue1,blue2,redScore,blueScore,startSec,endSec\n3,254,971,118,1114,142,98,30,180";
    expect(bulk(text).columnErrors.some((e) => e.includes("matchType"))).toBe(true);
    const result = bulk(text, { defaults: { matchType: "Qualification", youtubeUrl: `https://youtu.be/${ID}` } });
    expect(result.rows[0].match).toMatchObject({
      matchType: "Qualification",
      red: { penaltyPoints: 0 },
      blue: { penaltyPoints: 0 },
      video: { youtubeUrl: canonicalYouTubeUrl(ID), startSec: 30, endSec: 180 },
    });
    // A row's own link and match type win over the defaults.
    const own = bulk(`${HEADER}\nF,1,254,971,118,1114,142,98,,,https://youtu.be/abcdefghijk,0,100,`, { defaults: { matchType: "Qualification", youtubeUrl: `https://youtu.be/${ID}` } });
    expect(own.rows[0].match).toMatchObject({ matchType: "Playoff", video: { youtubeUrl: canonicalYouTubeUrl("abcdefghijk") } });
  });

  it("gives each bad row its own clear errors and still validates the rest", () => {
    const text = [
      HEADER,
      "Q,1,254,971,118,1114,142,98,6,0,,,,",
      "Q,2,254,254,118,1114,142,98,0,0,,,,", // duplicate team in one alliance
      "Q,3,abc,971,118,1114,142,98,0,0,,,,", // bad team number
      "Q,4,254,971,118,1114,10,98,12,0,,,,", // penalty > score
      "Q,5,254,971,118,1114,142,98,0,0,https://vimeo.com/1,0,100,", // not YouTube
      "Q,6,254,971,118,1114,142,98,0,0,https://youtu.be/" + ID + ",100,50,", // end before start
      "Q,,254,971,118,1114,142,98,0,0,,,,", // no match number
    ].join("\n");
    const result = bulk(text);
    const summary = summarizeBulk(result);
    expect(summary).toMatchObject({ total: 7, valid: 1, errors: 6, creates: 1 });
    expect(result.rows[1].errors.join(" ")).toMatch(/Red 2.*254/);
    expect(result.rows[2].errors.join(" ")).toMatch(/Red 1/);
    expect(result.rows[3].errors.join(" ")).toMatch(/Red penalty/);
    expect(result.rows[4].errors.join(" ")).toMatch(/YouTube/);
    expect(result.rows[5].errors.join(" ")).toMatch(/End/);
    expect(result.rows[6].errors.join(" ")).toMatch(/Match number/);
    // Row numbers point at the line in the pasted text (header = line 1).
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("requires an optional eventCode column to match the target event (or be blank)", () => {
    const text = `${HEADER},eventCode\n${goodRow(1)},MAN-T\n${goodRow(2)},man-t\n${goodRow(3)},\n${goodRow(4)},USWABON1`;
    const result = bulk(text);
    expect(result.rows.map((r) => r.errors.length === 0)).toEqual([true, true, true, false]);
    expect(result.rows[3].errors.join(" ")).toMatch(/eventCode.*USWABON1/);
  });

  it("distinguishes new matches from ones that would update existing manual matches", () => {
    const existing = new Map([["MAN-T_Q2", { origin: "manual" }]]);
    const summary = summarizeBulk(bulk(`${HEADER}\n${goodRow(1)}\n${goodRow(2)}`, { existing }));
    expect(summary).toMatchObject({ creates: 1, updates: 1 });
  });

  it("refuses to overwrite an API match — including a pre-P15 doc with no origin", () => {
    const existing = new Map<string, { origin?: unknown }>([["MAN-T_Q1", { origin: "api" }], ["MAN-T_Q2", {}]]);
    const result = bulk(`${HEADER}\n${goodRow(1)}\n${goodRow(2)}\n${goodRow(3)}`, { existing });
    expect(result.rows[0].errors.join(" ")).toMatch(/API/);
    expect(result.rows[1].errors.join(" ")).toMatch(/API/);
    expect(summarizeBulk(result)).toMatchObject({ errors: 2, creates: 1 });
  });

  it("is idempotent: importing the same text twice gives the same ids, the second time as updates", () => {
    const text = `${HEADER}\n${goodRow(1)}\n${goodRow(2)}`;
    const first = bulk(text);
    const existing = new Map(first.rows.map((r) => [r.id!, { origin: "manual" as const }]));
    const second = bulk(text, { existing });
    expect(second.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
    expect(summarizeBulk(first)).toMatchObject({ creates: 2, updates: 0 });
    expect(summarizeBulk(second)).toMatchObject({ creates: 0, updates: 2 });
  });

  it("when a match appears twice in the file, the later row wins and the earlier one is skipped with a note", () => {
    const result = bulk(`${HEADER}\n${goodRow(1)}\nQ,1,254,971,118,1114,200,100,0,0,,,,\n${goodRow(2)}`);
    const summary = summarizeBulk(result);
    expect(summary).toMatchObject({ total: 3, valid: 3, superseded: 1 });
    expect(summary.importable.map((r) => r.id)).toEqual(["MAN-T_Q1", "MAN-T_Q2"]);
    expect(summary.importable[0].match?.red.score).toBe(200);
    expect(result.rows[0].superseded).toBe(true);
    expect(result.rows[0].warnings.join(" ")).toMatch(/row 3/);
  });

  it("skips blank lines and handles quoted cells and Windows line endings", () => {
    const text = `${HEADER}\r\n\r\nQ,1,254,971,118,1114,142,98,6,0,,,,"said, ""good"""\r\n\r\n`;
    const result = bulk(text);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].match?.notes).toBe('said, "good"');
  });

  it("reads the start/end columns in any time format", () => {
    const result = bulk(`${HEADER}\nQ,1,254,971,118,1114,142,98,6,0,https://youtu.be/${ID},1:10,3:40,`);
    expect(result.rows[0].match?.video).toMatchObject({ startSec: 70, endSec: 220 });
  });
});

describe("event form", () => {
  const form = (over = {}) => ({ name: "Kitchen Scrimmage", code: "", date: "", sourceUrl: "", defaultVideoUrl: "", ...over });

  it("accepts a name alone, and a fully filled form", () => {
    expect(validateEventForm(form()).ok).toBe(true);
    expect(validateEventForm(form({ code: "MAN-K1", date: "2026-11-05", sourceUrl: "https://example.com/scores", defaultVideoUrl: `https://youtu.be/${ID}` })).ok).toBe(true);
  });

  it("requires a name and rejects bad dates, non-https source links, and non-YouTube default videos", () => {
    expect(validateEventForm(form({ name: "  " })).errors.name).toBeTruthy();
    expect(validateEventForm(form({ name: "x".repeat(121) })).errors.name).toBeTruthy();
    expect(validateEventForm(form({ date: "2026-02-30" })).errors.date).toBeTruthy();
    expect(validateEventForm(form({ date: "Nov 5" })).errors.date).toBeTruthy();
    expect(validateEventForm(form({ sourceUrl: "http://example.com" })).errors.sourceUrl).toBeTruthy();
    expect(validateEventForm(form({ sourceUrl: "javascript:alert(1)" })).errors.sourceUrl).toBeTruthy();
    expect(validateEventForm(form({ defaultVideoUrl: "https://vimeo.com/1" })).errors.defaultVideoUrl).toBeTruthy();
  });
});

describe("buildManualMatchDoc", () => {
  const event = { eventCode: "MAN-T", eventName: "T", seasonId: "biobuzz" };
  const match = () => validateRawMatch(raw()).match!;
  const options = { newPublished: false, newNeedsReview: true };

  it("a new match gets the caller's publishing state, origin 'manual', the actor as creator, and fresh timestamps", () => {
    expect(buildManualMatchDoc(match(), event, null, options, "uid-1", "2026-11-05T00:00:00.000Z")).toMatchObject({
      origin: "manual",
      published: false,
      needsReview: true,
      createdBy: "uid-1",
      importedAt: "2026-11-05T00:00:00.000Z",
      scoresUpdatedAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
      eventCode: "MAN-T",
    });
  });

  it("an edit keeps what the match already had (published state, review flag, creator, first-import time) and refreshes the rest", () => {
    const existing = { published: true, needsReview: false, createdBy: "uid-0", importedAt: "2026-10-01T00:00:00.000Z" };
    const doc = buildManualMatchDoc(match(), event, existing, options, "uid-1", "2026-11-05T00:00:00.000Z");
    expect(doc).toMatchObject({ published: true, needsReview: false, createdBy: "uid-0", importedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z" });
    // A match still awaiting review stays unpublished and flagged when its numbers are corrected.
    expect(buildManualMatchDoc(match(), event, { published: false, needsReview: true, createdBy: "uid-0" }, { newPublished: true, newNeedsReview: false }, "uid-1", "x")).toMatchObject({ published: false, needsReview: true });
  });

  it("difficulty always follows the (possibly edited) scores", () => {
    const edited = validateRawMatch(raw({ redScore: "30", redPenalty: "0" })).match!;
    expect(buildManualMatchDoc(edited, event, { published: true }, options, "u", "n").alliances.red.difficulty).toBe("easy");
  });
});

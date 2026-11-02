import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  clampAccuracy,
  filtersToQuery,
  isDefaultFilters,
  mergeFilterParams,
  parseAccuracyText,
  parseFilters,
  resolveEventCodes,
  resolveSingleEventCode,
  sanitizeAccuracyText,
  serializeFilters,
  type AnalyticsFilters,
} from "./filters";

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe("accuracy input", () => {
  it("clamps to a whole number from 1 to 100", () => {
    expect(clampAccuracy(0)).toBe(1);
    expect(clampAccuracy(-5)).toBe(1);
    expect(clampAccuracy(150)).toBe(100);
    expect(clampAccuracy(87.6)).toBe(88);
    expect(clampAccuracy(Number.NaN)).toBe(1);
  });

  it("accepts only 1-3 digits", () => {
    expect(sanitizeAccuracyText("a8b7c")).toBe("87");
    expect(sanitizeAccuracyText("12345")).toBe("123");
    expect(sanitizeAccuracyText("-5")).toBe("5");
    expect(sanitizeAccuracyText("")).toBe("");
  });

  it("parses a draft: empty is null, out-of-range values clamp", () => {
    expect(parseAccuracyText("")).toBeNull();
    expect(parseAccuracyText("abc")).toBeNull();
    expect(parseAccuracyText("0")).toBe(1);
    expect(parseAccuracyText("150")).toBe(100);
    expect(parseAccuracyText("87")).toBe(87);
  });
});

describe("parseFilters", () => {
  it("defaults when the URL has no params", () => {
    expect(parse("")).toEqual(DEFAULT_FILTERS);
  });

  it("reads every control", () => {
    expect(parse("events=uswabon1,USWASEQ&practice=1&mode=trial&source=live&acc=85")).toEqual({
      gameId: "biobuzz",
      events: { kind: "custom", codes: ["USWABON1", "USWASEQ"] },
      practice: true,
      practiceMode: "trial",
      practiceSource: "live",
      accuracy: 85,
    });
    expect(parse("events=all").events).toEqual({ kind: "all" });
  });

  it("ignores invalid values instead of producing an impossible state", () => {
    expect(parse("game=nonsense").gameId).toBe("biobuzz");
    expect(parse("mode=banana&practice=1").practiceMode).toBe("all");
    expect(parse("source=banana&practice=1").practiceSource).toBe("all");
    expect(parse("acc=abc").accuracy).toBeNull();
    expect(parse("acc=1234").accuracy).toBeNull();
    expect(parse("events=<script>").events).toEqual({ kind: "active" });
  });

  it("clamps a custom accuracy from the URL", () => {
    expect(parse("acc=0").accuracy).toBe(1);
    expect(parse("acc=999").accuracy).toBe(100);
  });
});

describe("serializeFilters", () => {
  it("writes nothing for the default view", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
  });

  it("round-trips a fully customized state", () => {
    const filters: AnalyticsFilters = {
      gameId: "biobuzz",
      events: { kind: "custom", codes: ["USWABON1"] },
      practice: true,
      practiceMode: "competitive",
      practiceSource: "practice",
      accuracy: 90,
    };
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
  });

  it("drops practice mode/source while practice is off", () => {
    const qs = filtersToQuery({ ...DEFAULT_FILTERS, practiceMode: "trial", practiceSource: "live" });
    expect(qs).toBe("");
  });
});

describe("mergeFilterParams", () => {
  it("replaces the filter params and keeps every other param", () => {
    const merged = mergeFilterParams("acc=75&team=254&match=Q3&events=all", { ...DEFAULT_FILTERS, accuracy: 90 });
    expect(Object.fromEntries(merged)).toEqual({ acc: "90", team: "254", match: "Q3" });
  });

  it("drops filter params that went back to default", () => {
    expect(mergeFilterParams("acc=75&practice=1&mode=trial", DEFAULT_FILTERS).toString()).toBe("");
  });
});

describe("resolveEventCodes", () => {
  it("uses the active events by default, all/custom as chosen", () => {
    expect(resolveEventCodes(DEFAULT_FILTERS, ["A", "B"])).toEqual(["A", "B"]);
    expect(resolveEventCodes({ ...DEFAULT_FILTERS, events: { kind: "all" } }, ["A"])).toBeNull();
    expect(resolveEventCodes({ ...DEFAULT_FILTERS, events: { kind: "custom", codes: ["Z"] } }, ["A"])).toEqual(["Z"]);
  });

  it("treats 'active' as every event in practice mode", () => {
    expect(resolveEventCodes({ ...DEFAULT_FILTERS, practice: true }, ["A"])).toBeNull();
  });

  it("an empty active set means no events (not 'everything')", () => {
    expect(resolveEventCodes(DEFAULT_FILTERS, [])).toEqual([]);
  });
});

describe("resolveSingleEventCode", () => {
  it("prefers the first chosen event, then the fallback", () => {
    expect(resolveSingleEventCode({ ...DEFAULT_FILTERS, events: { kind: "custom", codes: ["X", "Y"] } }, "F")).toBe("X");
    expect(resolveSingleEventCode(DEFAULT_FILTERS, "F")).toBe("F");
    expect(resolveSingleEventCode({ ...DEFAULT_FILTERS, events: { kind: "all" } }, null)).toBeNull();
  });
});

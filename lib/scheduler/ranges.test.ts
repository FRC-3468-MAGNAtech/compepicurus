import { describe, expect, it } from "vitest";
import type { MatchInput } from "./types";
import { filterMatchesByCategories, filterMatchesByRanges, parseMatchRanges } from "./ranges";

function match(matchType: MatchInput["matchType"], matchNumber: number): MatchInput {
  return { matchType, matchNumber, red: [1, 2], blue: [3, 4] };
}

describe("parseMatchRanges", () => {
  it("parses prefixed ranges and single matches", () => {
    const { ranges, errors } = parseMatchRanges("P12-14, Q17-18, F2-3, Q5");
    expect(errors).toHaveLength(0);
    expect(ranges).toEqual([
      { matchType: "Practice", start: 12, end: 14 },
      { matchType: "Qualification", start: 17, end: 18 },
      { matchType: "Playoff", start: 2, end: 3 },
      { matchType: "Qualification", start: 5, end: 5 },
    ]);
  });

  it("is case-insensitive on the prefix", () => {
    const { ranges, errors } = parseMatchRanges("q1-2");
    expect(errors).toHaveLength(0);
    expect(ranges[0].matchType).toBe("Qualification");
  });

  it("reports an unrecognized chip as an error instead of dropping it silently", () => {
    const { ranges, errors } = parseMatchRanges("Z1-2");
    expect(ranges).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("reports an inverted range as an error", () => {
    const { ranges, errors } = parseMatchRanges("Q10-5");
    expect(ranges).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("ignores blank chips from stray commas/whitespace", () => {
    const { ranges, errors } = parseMatchRanges("Q1,  , Q2");
    expect(errors).toHaveLength(0);
    expect(ranges).toHaveLength(2);
  });
});

describe("filterMatchesByRanges", () => {
  it("keeps only matches inside the given ranges", () => {
    const matches = [match("Qualification", 1), match("Qualification", 2), match("Qualification", 3), match("Playoff", 1)];
    const { matches: filtered } = filterMatchesByRanges(matches, [{ matchType: "Qualification", start: 2, end: 3 }]);
    expect(filtered.map((m) => m.matchNumber)).toEqual([2, 3]);
  });

  it("warns about range bounds that don't exist in the match list", () => {
    const matches = [match("Qualification", 1)];
    const { warnings } = filterMatchesByRanges(matches, [{ matchType: "Qualification", start: 1, end: 3 }]);
    expect(warnings).toHaveLength(2); // Q2 and Q3 don't exist
  });
});

describe("filterMatchesByCategories", () => {
  it("keeps only matches of the selected types", () => {
    const matches = [match("Practice", 1), match("Qualification", 1), match("Playoff", 1)];
    const filtered = filterMatchesByCategories(matches, ["Qualification", "Playoff"]);
    expect(filtered.map((m) => m.matchType)).toEqual(["Qualification", "Playoff"]);
  });
});

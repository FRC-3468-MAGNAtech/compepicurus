import { describe, expect, it } from "vitest";
import { determineJoinOption } from "./join-rules";

const RED: [number, number] = [100, 200];
const BLUE: [number, number] = [300, 400];

describe("determineJoinOption", () => {
  it("returns 'none' when nobody is covering the match yet", () => {
    expect(determineJoinOption([], RED, BLUE)).toEqual({ kind: "none" });
  });

  it("forces the joiner onto the same alliance's other robot", () => {
    const result = determineJoinOption([{ teamNumber: 100, alliance: "red" }], RED, BLUE);
    expect(result).toEqual({ kind: "forced", alliance: "red", teamNumber: 200 });
  });

  it("offers a free choice from the other alliance once the first is fully covered", () => {
    const covered = [
      { teamNumber: 100, alliance: "red" as const },
      { teamNumber: 200, alliance: "red" as const },
    ];
    const result = determineJoinOption(covered, RED, BLUE);
    expect(result).toEqual({ kind: "choice", alliance: "blue", teamNumbers: BLUE });
  });

  it("returns 'none' once both alliances are fully covered", () => {
    const covered = [
      { teamNumber: 100, alliance: "red" as const },
      { teamNumber: 200, alliance: "red" as const },
      { teamNumber: 300, alliance: "blue" as const },
      { teamNumber: 400, alliance: "blue" as const },
    ];
    expect(determineJoinOption(covered, RED, BLUE)).toEqual({ kind: "none" });
  });

  it("forces onto whichever alliance is partially covered when both have exactly one", () => {
    const covered = [
      { teamNumber: 100, alliance: "red" as const },
      { teamNumber: 300, alliance: "blue" as const },
    ];
    const result = determineJoinOption(covered, RED, BLUE);
    expect(result.kind).toBe("forced");
  });
});

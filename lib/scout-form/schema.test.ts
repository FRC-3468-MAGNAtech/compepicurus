import { describe, expect, it } from "vitest";
import {
  BIOBUZZ_FORM_SCHEMA,
  allFields,
  calculateScore,
  defaultValuesForSchema,
  scoutEntryFieldsToValues,
  valuesToScoutEntryFields,
} from "@/lib/scout-form/schema";
import { initialScoutEntryFields } from "@/lib/scout-entries";

describe("calculateScore", () => {
  it("scores an empty match as zero", () => {
    const values = defaultValuesForSchema(BIOBUZZ_FORM_SCHEMA);
    expect(calculateScore(BIOBUZZ_FORM_SCHEMA, values)).toEqual({ auto: 0, teleop: 0, endgame: 0, total: 0 });
  });

  it("adds up auto points", () => {
    const values = scoutEntryFieldsToValues({ ...initialScoutEntryFields, autoLeave: true, autoPark: true, autoTipHive: 2 });
    expect(calculateScore(BIOBUZZ_FORM_SCHEMA, values).auto).toBe(3 + 5 + 2 * 20);
  });

  it("adds up teleop points across hive, flower, and garden", () => {
    const values = scoutEntryFieldsToValues({
      ...initialScoutEntryFields,
      teleTipHive: 1,
      flowerBottomNectar: true,
      flowerPollenNectar: 3,
      gardenPollenNectar: 4,
    });
    expect(calculateScore(BIOBUZZ_FORM_SCHEMA, values).teleop).toBe(20 + 5 + 3 * 2 + 4 * 1);
  });

  it("adds endgame park points", () => {
    const values = scoutEntryFieldsToValues({ ...initialScoutEntryFields, endgamePark: true });
    expect(calculateScore(BIOBUZZ_FORM_SCHEMA, values).endgame).toBe(5);
  });

  it("totals every section", () => {
    const values = scoutEntryFieldsToValues({
      ...initialScoutEntryFields,
      autoLeave: true,
      teleTipHive: 1,
      endgamePark: true,
    });
    const score = calculateScore(BIOBUZZ_FORM_SCHEMA, values);
    expect(score.total).toBe(score.auto + score.teleop + score.endgame);
  });

  it("never lets a checkbox incident flag contribute points", () => {
    const values = scoutEntryFieldsToValues({ ...initialScoutEntryFields, diedDuringMatch: true, yellowCard: true, redCard: true });
    expect(calculateScore(BIOBUZZ_FORM_SCHEMA, values)).toEqual({ auto: 0, teleop: 0, endgame: 0, total: 0 });
  });

  it("ignores the comments text field entirely", () => {
    const values = { ...defaultValuesForSchema(BIOBUZZ_FORM_SCHEMA), comments: "robot tipped twice" };
    expect(calculateScore(BIOBUZZ_FORM_SCHEMA, values)).toEqual({ auto: 0, teleop: 0, endgame: 0, total: 0 });
  });
});

describe("valuesToScoutEntryFields / scoutEntryFieldsToValues", () => {
  it("round-trips without losing or inventing fields", () => {
    const fields = { ...initialScoutEntryFields, autoTipHive: 3, yellowCard: true };
    const roundTripped = valuesToScoutEntryFields(scoutEntryFieldsToValues(fields));
    expect(roundTripped).toEqual(fields);
  });
});

describe("allFields", () => {
  it("flattens both flat sections and grouped (H2) sections", () => {
    const keys = allFields(BIOBUZZ_FORM_SCHEMA).map((f) => f.key);
    // autonomous is flat; teleop uses groups (Hive/Flower/Garden) — both must surface.
    expect(keys).toContain("autoLeave");
    expect(keys).toContain("teleTipHive");
    expect(keys).toContain("flowerPollenNectar");
    expect(keys).toContain("comments");
  });
});

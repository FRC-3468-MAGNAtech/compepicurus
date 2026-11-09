import { describe, expect, it } from "vitest";
import { buildGameSchema } from "@/lib/analytics/game-schema";
import { entriesToCsv } from "@/lib/analytics/csv";
import { formEntryDoc, formEntryToRow, formMatchKey, parseFormMatchKey, toFormEntry } from "@/lib/form-entries-model";
import { addField, defaultField, setFormStickyNotes } from "@/lib/forms/edit";
import { createBlankForm } from "@/lib/forms/new-form";
import { normalizeValues } from "@/lib/forms/values";

describe("form entries model", () => {
  it("writes the document the rules expect, with optional parts only when given", () => {
    const doc = formEntryDoc("t1", "u1", { scoutName: "Ada", formId: "pit-scout-v1", formVersion: 2, formType: "pit-scout", eventCode: "EVT", values: { a: 1 } }, () => "NOW");
    expect(doc).toEqual({ teamId: "t1", uid: "u1", scoutName: "Ada", formId: "pit-scout-v1", formVersion: 2, formType: "pit-scout", eventCode: "EVT", values: { a: 1 }, stickyNotes: [], flags: [], excluded: false, createdAt: "NOW", updatedAt: "NOW" });
    const full = formEntryDoc("t1", "u1", { scoutName: "Ada", formId: "x", formVersion: 1, formType: "drive-reflection", eventCode: "EVT", matchKey: "Q5", alliance: "red", teamNumber: null, values: {}, linkedEntryId: "p", planDifferences: 2 }, () => "NOW");
    expect(full).toMatchObject({ matchKey: "Q5", alliance: "red", teamNumber: null, linkedEntryId: "p", planDifferences: 2 });
    expect(Object.values(full)).not.toContain(undefined);
  });

  it("round-trips the match key", () => {
    expect(formMatchKey("Qualification", 12)).toBe("Q12");
    expect(formMatchKey("Playoff", 3)).toBe("F3");
    expect(formMatchKey("Practice", 1)).toBe("P1");
    expect(parseFormMatchKey("Q12")).toEqual({ matchType: "Qualification", matchNumber: 12 });
    expect(parseFormMatchKey("F3")).toEqual({ matchType: "Playoff", matchNumber: 3 });
    expect(parseFormMatchKey("X1")).toBeNull();
    expect(parseFormMatchKey(null)).toBeNull();
  });

  it("reads a stored document tolerantly", () => {
    const e = toFormEntry("e1", { teamId: "t", uid: "u", formType: "pit-scout", alliance: "green", teamNumber: "x", values: null, createdAt: { toMillis: () => 5000 } });
    expect(e).toMatchObject({ id: "e1", alliance: null, teamNumber: null, values: {}, stickyNotes: [], flags: [], excluded: false, createdAtMs: 5000 });
  });

  it("shows up in the same analytics table and CSV as any entry: unscored, with notes joined", () => {
    let form = createBlankForm({ id: "pit-scout-v1", name: "Pit", createdBy: "u", formType: "pit-scout" });
    form = addField(form, "misc", { ...defaultField(form, "slider", "Build quality"), key: "build" });
    form = setFormStickyNotes(form, { enabled: true, defaultOpen: false });
    const entry = toFormEntry("e1", {
      teamId: "t",
      uid: "u",
      scoutName: "Ada",
      formId: "pit-scout-v1",
      formVersion: 1,
      formType: "pit-scout",
      eventCode: "EVT",
      teamNumber: 254,
      values: normalizeValues(form, { build: 4 }),
      stickyNotes: [
        { id: "1", text: "tidy wiring", color: "y", createdAt: 1 },
        { id: "2", text: "big battery", color: "y", createdAt: 2 },
      ],
      createdAt: { toMillis: () => 1000 },
    });
    const row = formEntryToRow(entry, form);
    expect(row.scored).toBe(false);
    expect(row.teamNumber).toBe(254);
    expect(row.comments).toBe("tidy wiring | big battery");
    const csv = entriesToCsv(buildGameSchema(form), [row], (n) => n);
    const [header, line] = csv.split("\r\n");
    expect(header).toContain("Build quality");
    expect(header).toContain("Notes");
    expect(line).toContain("tidy wiring | big battery");
    expect(header).not.toContain("Alliance Accuracy");
  });
});

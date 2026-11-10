import { describe, expect, it } from "vitest";
import { dedupeFormImport, entriesToCsv, parseFormImportCsv } from "@/lib/analytics/csv";
import { buildFormSchema, formAnalyticsPage } from "@/lib/analytics/form-analytics";
import { formEntryToRow, type FormEntry } from "@/lib/form-entries-model";
import { PIT_SCOUT_FORM } from "@/lib/forms/builtin-pit-forms";
import { DRIVE_REFLECTION_FORM, LEAD_SCOUT_FORM } from "@/lib/forms/builtin-team-forms";
import { normalizeValues } from "@/lib/forms/values";
import type { Form } from "@/lib/forms/types";

let n = 0;
const entry = (form: Form, over: Partial<FormEntry>): FormEntry => ({
  id: `e${++n}`,
  teamId: "t",
  uid: "u",
  scoutName: "Ada, the Scout",
  formId: form.id,
  formVersion: 1,
  formType: form.formType as FormEntry["formType"],
  eventCode: "EVT1",
  teamNumber: null,
  values: {},
  stickyNotes: [],
  flags: [],
  excluded: false,
  createdAtMs: n,
  updatedAtMs: n,
  ...over,
});

const roundTrip = (form: Form, entries: FormEntry[], multi = false) => {
  const page = formAnalyticsPage(form.formType)!;
  const schema = buildFormSchema(form, { multiEvent: multi, page });
  const csv = entriesToCsv(schema, entries.map((e) => formEntryToRow(e, form)), (s) => s);
  return { csv, parsed: parseFormImportCsv(schema, csv) };
};

describe("exporting and importing a new form's CSV", () => {
  it("Pit Scout round-trips: team, scout (with a comma), numbers, the unit, the grid, the auto cycle and the notes", () => {
    const values = normalizeValues(PIT_SCOUT_FORM, { weight: 24.5, weightUnit: "kg", rookie: true, capacity: 6, cycleTime: 12.5, friendlyPit: true, capabilities: { hive_auto: true, park_teleop: true }, autoCycle: ["leave", "hive", "garden", "hive", "park"] });
    const e = entry(PIT_SCOUT_FORM, { teamNumber: 4321, values, stickyNotes: [{ id: "1", text: "nice robot", color: "yellow", createdAt: 1 }, { id: "2", text: "tall", color: "yellow", createdAt: 2 }] });
    const { csv, parsed } = roundTrip(PIT_SCOUT_FORM, [e]);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0];
    expect(row).toMatchObject({ scoutName: "Ada, the Scout", teamNumber: 4321, matchKey: null, alliance: null, eventCode: null, notes: ["nice robot", "tall"] });
    expect(normalizeValues(PIT_SCOUT_FORM, row.values)).toEqual(values);
  });

  it("Lead Scout (match, alliance and per-team slots) round-trips, with the Event column when several events are shown", () => {
    const values = normalizeValues(LEAD_SCOUT_FORM, { allianceNotes: "solid", allianceSkill: 4, t1_team: 100, t1_skill: 5, t1_notes: "fast", t2_team: 200, t2_skill: 2 });
    const e = entry(LEAD_SCOUT_FORM, { matchKey: "Q12", alliance: "blue", values });
    const { parsed } = roundTrip(LEAD_SCOUT_FORM, [e], true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ matchKey: "Q12", alliance: "blue", eventCode: "EVT1", teamNumber: null });
    expect(normalizeValues(LEAD_SCOUT_FORM, parsed.rows[0].values)).toEqual(values);
  });

  it("a wrong file is refused with the missing column named, and nothing is read", () => {
    const schema = buildFormSchema(PIT_SCOUT_FORM, { multiEvent: false });
    const r = parseFormImportCsv(schema, "Hello,World\r\n1,2");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toMatch(/Missing expected column/);
    expect(parseFormImportCsv(schema, "").errors).toEqual(["The file is empty."]);
  });

  it("a row with a bad match, alliance or team is reported and skipped, the rest are kept", () => {
    const good = entry(DRIVE_REFLECTION_FORM, { matchKey: "Q1", alliance: "red", values: normalizeValues(DRIVE_REFLECTION_FORM, { t1_team: 1, t1_role: "hive" }) });
    const { csv } = roundTrip(DRIVE_REFLECTION_FORM, [good]);
    const lines = csv.split("\r\n");
    const header = lines[0].split(",");
    const bad = lines[1].split(",");
    bad[header.indexOf("Information - Information - Match")] = "Z9";
    const parsed = parseFormImportCsv(buildFormSchema(DRIVE_REFLECTION_FORM, { multiEvent: false, page: formAnalyticsPage("drive-reflection")! }), [lines[0], lines[1], bad.join(",")].join("\r\n"));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toEqual([expect.stringContaining("Row 3")]);
  });

  it("importing the same file twice adds nothing the second time", () => {
    const e = entry(PIT_SCOUT_FORM, { teamNumber: 7, values: normalizeValues(PIT_SCOUT_FORM, { weight: 10 }) });
    const { parsed } = roundTrip(PIT_SCOUT_FORM, [e]);
    const rows = parsed.rows.map((r) => ({ ...r, values: normalizeValues(PIT_SCOUT_FORM, r.values) }));
    const existing = [{ eventCode: "EVT1", matchKey: null, alliance: null, teamNumber: 7, scoutName: "Ada, the Scout", values: e.values }];
    expect(dedupeFormImport(rows, existing, "EVT1")).toMatchObject({ skipped: 1, toInsert: [] });
    expect(dedupeFormImport(rows, [], "EVT1")).toMatchObject({ skipped: 0 });
    expect(dedupeFormImport([...rows, ...rows], [], "EVT1").toInsert).toHaveLength(1);
  });
});

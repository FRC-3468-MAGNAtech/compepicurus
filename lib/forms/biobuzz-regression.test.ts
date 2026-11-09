import { describe, expect, it } from "vitest";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues, normalizeValues, valueFields } from "@/lib/forms/values";
import { entryValues, hasLegacyShape, legacyFieldsFromValues } from "@/lib/forms/legacy";
import { checkForm } from "@/lib/forms/validate";
import { visibleFieldKeys } from "@/lib/forms/visibility";
import * as oracle from "@/lib/forms/fixtures/biobuzz-v1";
import { BIOBUZZ_SCHEMA as OLD_TABLE } from "@/lib/forms/fixtures/biobuzz-v1-game-schema";
import { BIOBUZZ_SCHEMA as NEW_TABLE_FULL, buildGameSchema, csvHeaderFor } from "@/lib/analytics/game-schema";

// P28: BIOBUZZ now has the sticky notes panel on, which adds ONE derived column (Notes) to its table. Everything else must still be exactly the old table, so the
// comparison is against the new table without that one column; a separate test pins that it is the only difference.
const NEW_TABLE = { ...NEW_TABLE_FULL, columns: NEW_TABLE_FULL.columns.filter((c) => c.key !== "stickyNotes") };
import { entriesToCsv, parseImportCsv } from "@/lib/analytics/csv";
import { entryPayloadFor, type ScoutEntry } from "@/lib/scout-entries";
import { evaluateAutoFlagRuleIds } from "@/lib/analytics/flags";
import { buildTeamStats } from "@/lib/analytics/team-stats";

// P21 regression: BIOBUZZ, now one built-in among schema-v2 forms, must behave exactly as it did when it was hard-coded. The "oracle" is a
// frozen copy of the old code (lib/forms/fixtures/biobuzz-v1*.ts), never imported by the app.

/** A small seeded PRNG so the fuzz cases are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const oracleFields = oracle.allFields(oracle.BIOBUZZ_FORM_SCHEMA);

function randomValues(rand: () => number): Record<string, boolean | number | string> {
  const v: Record<string, boolean | number | string> = {};
  for (const f of oracleFields) {
    if (f.type === "counter") v[f.key] = Math.floor(rand() * 14);
    else if (f.type === "text") v[f.key] = rand() < 0.5 ? "" : "some note";
    else v[f.key] = rand() < 0.5;
  }
  return v;
}

describe("BIOBUZZ regression: the form", () => {
  it("has exactly the old fields, in the old order", () => {
    expect(valueFields(BIOBUZZ_FORM).map((f) => f.key)).toEqual(oracleFields.map((f) => f.key));
  });

  it("is valid schema v2 with no errors or warnings, and is still the legacy-shaped lineage", () => {
    expect(checkForm(BIOBUZZ_FORM)).toEqual([]);
    expect(hasLegacyShape(BIOBUZZ_FORM)).toBe(true);
    expect(BIOBUZZ_FORM.version).toBe(1);
  });

  it("has the same defaults as before", () => {
    const old = oracle.defaultValuesForSchema(oracle.BIOBUZZ_FORM_SCHEMA);
    const now = defaultValues(BIOBUZZ_FORM);
    for (const [k, v] of Object.entries(old)) expect(now[k], k).toEqual(v);
  });

  it("every field is visible (BIOBUZZ has no conditions)", () => {
    const visible = visibleFieldKeys(BIOBUZZ_FORM, defaultValues(BIOBUZZ_FORM));
    for (const f of oracleFields) expect(visible.has(f.key), f.key).toBe(true);
  });
});

describe("BIOBUZZ regression: scoring", () => {
  it("scores the all-off and all-on forms like the old code", () => {
    const off = oracle.defaultValuesForSchema(oracle.BIOBUZZ_FORM_SCHEMA);
    const on = Object.fromEntries(oracleFields.map((f) => [f.key, f.type === "counter" ? 5 : f.type === "text" ? "" : true]));
    for (const values of [off, on]) {
      const old = oracle.calculateScore(oracle.BIOBUZZ_FORM_SCHEMA, values);
      const now = calculateScore(BIOBUZZ_FORM, values);
      expect({ auto: now.auto, teleop: now.teleop, endgame: now.endgame, total: now.total }).toEqual(old);
    }
  });

  it("matches the old code on 1,000 seeded random entries (every phase subtotal and the total)", () => {
    const rand = rng(20260);
    for (let i = 0; i < 1000; i++) {
      const values = randomValues(rand);
      const old = oracle.calculateScore(oracle.BIOBUZZ_FORM_SCHEMA, values);
      const now = calculateScore(BIOBUZZ_FORM, values);
      expect({ auto: now.auto, teleop: now.teleop, endgame: now.endgame, total: now.total }, JSON.stringify(values)).toEqual(old);
    }
  });

  it("scores each tile the way the old points table did, one at a time", () => {
    const base = oracle.defaultValuesForSchema(oracle.BIOBUZZ_FORM_SCHEMA);
    for (const f of oracleFields) {
      if (f.type === "text") continue;
      const values = { ...base, [f.key]: f.type === "counter" ? 3 : true };
      const old = oracle.calculateScore(oracle.BIOBUZZ_FORM_SCHEMA, values);
      const now = calculateScore(BIOBUZZ_FORM, values);
      expect(now.total, f.key).toBe(old.total);
    }
  });

  it("ignores values it doesn't know and tolerates junk, like the old code did for unknown keys", () => {
    const values = { ...oracle.defaultValuesForSchema(oracle.BIOBUZZ_FORM_SCHEMA), notAField: 99 };
    expect(calculateScore(BIOBUZZ_FORM, values).total).toBe(oracle.calculateScore(oracle.BIOBUZZ_FORM_SCHEMA, values).total);
  });
});

describe("BIOBUZZ regression: stored entries (the adapter)", () => {
  const legacyEntry = () => {
    const fields = oracle.valuesToScoutEntryFields({ ...oracle.defaultValuesForSchema(oracle.BIOBUZZ_FORM_SCHEMA), autoLeave: true, teleTipHive: 4, redCard: true });
    return { fields, comments: "hit the wall", score: { auto: 0, teleop: 0, endgame: 0, total: 0 } };
  };

  it("reads a pre-v2 entry (typed `fields` + `comments`, no values) into the same values the old reader built", () => {
    const e = legacyEntry();
    const values = entryValues(e, BIOBUZZ_FORM);
    expect(values).toMatchObject({ ...oracle.scoutEntryFieldsToValues(e.fields), comments: "hit the wall" });
    expect(values.autoLeave).toBe(true);
    expect(values.teleTipHive).toBe(4);
  });

  it("reads a new entry from `values`, and prefers it over legacy fields when both exist", () => {
    const e = { ...legacyEntry(), values: { autoLeave: false, teleTipHive: 9, comments: "new" } };
    expect(entryValues(e, BIOBUZZ_FORM)).toMatchObject({ autoLeave: false, teleTipHive: 9, comments: "new" });
  });

  it("never mutates the stored entry", () => {
    const e = legacyEntry();
    const snapshot = JSON.stringify(e);
    entryValues(e, BIOBUZZ_FORM);
    expect(JSON.stringify(e)).toBe(snapshot);
  });

  it("dual-writes: a new BIOBUZZ entry also carries the exact legacy `fields` and `comments` the old save wrote", () => {
    const rand = rng(77);
    for (let i = 0; i < 50; i++) {
      const values = normalizeValues(BIOBUZZ_FORM, randomValues(rand));
      const payload = entryPayloadFor(BIOBUZZ_FORM, values, calculateScore(BIOBUZZ_FORM, values));
      expect(payload.fields).toEqual(oracle.valuesToScoutEntryFields(values as never));
      expect(payload.comments).toBe(String(values.comments ?? ""));
      expect(payload.formId).toBe("biobuzz");
      expect(payload.formVersion).toBe(1);
      expect(payload.values).toEqual(values);
      expect(payload.scored).toBeUndefined();
      expect(legacyFieldsFromValues(values)).toEqual(payload.fields);
    }
  });

  it("round-trips: values -> stored payload -> values", () => {
    const values = normalizeValues(BIOBUZZ_FORM, { autoLeave: true, autoTipHive: 2, comments: "ok" });
    const payload = entryPayloadFor(BIOBUZZ_FORM, values, calculateScore(BIOBUZZ_FORM, values));
    expect(entryValues(payload, BIOBUZZ_FORM)).toMatchObject(values);
    // and through the legacy half alone (an old reader / a rollback)
    expect(entryValues({ fields: payload.fields, comments: payload.comments }, BIOBUZZ_FORM)).toMatchObject({ autoLeave: true, autoTipHive: 2, comments: "ok" });
  });
});

// --- Match Analytics table and CSV -------------------------------------------------------------------------------

function legacyEntries(n: number): ScoutEntry[] {
  const rand = rng(4242);
  return Array.from({ length: n }, (_, i) => {
    const values = randomValues(rand);
    const fields = oracle.valuesToScoutEntryFields(values);
    const score = oracle.calculateScore(oracle.BIOBUZZ_FORM_SCHEMA, values);
    return {
      id: `e${i}`,
      teamId: "team-1",
      uid: "u1",
      source: "event",
      mode: null,
      formId: "biobuzz",
      formVersion: 1,
      scoutName: i % 3 === 0 ? "Ada, \"the\" Scout" : "Grace",
      eventCode: "USWABON1",
      matchType: i % 2 === 0 ? "Qualification" : "Practice",
      matchNumber: i + 1,
      teamNumber: 3468 + (i % 4),
      fields,
      score,
      comments: i % 4 === 0 ? "multi\nline, with comma" : (values.comments as string),
      submittedAt: "2026-01-01T00:00:00.000Z",
      excluded: false,
      autoFlags: [],
      manualFlags: [],
      accuracy: i % 5 === 0 ? { status: "complete", value: 0.8, scoutedTotal: 50, penaltyPoints: 0, officialScore: 60 } : null,
    } as unknown as ScoutEntry;
  });
}

describe("BIOBUZZ regression: the Match Analytics table", () => {
  it("has the same columns, in the same order, with the same headers", () => {
    const strip = (cols: typeof OLD_TABLE.columns) => cols.map((c) => ({ key: c.key, phase: c.phase, category: c.category, label: c.label, type: c.type, sortable: c.sortable, sticky: c.sticky, width: c.width }));
    expect(strip(NEW_TABLE.columns as never)).toEqual(strip(OLD_TABLE.columns));
    expect(NEW_TABLE.columns.map(csvHeaderFor)).toEqual(OLD_TABLE.columns.map((c) => `${c.phase} - ${c.category} - ${c.label}`));
  });

  it("derives every cell to the same value for old-shaped entries", () => {
    for (const e of legacyEntries(40)) {
      for (const [i, col] of OLD_TABLE.columns.entries()) {
        expect(NEW_TABLE.columns[i].getValue(e), `${col.key} / ${e.id}`).toEqual(col.getValue(e));
      }
    }
  });

  it("derives the same cells for the same entries stored as new values + dual-written fields", () => {
    for (const e of legacyEntries(20)) {
      const values = normalizeValues(BIOBUZZ_FORM, entryValues(e, BIOBUZZ_FORM));
      const stored = { ...e, ...entryPayloadFor(BIOBUZZ_FORM, values, calculateScore(BIOBUZZ_FORM, values)) } as ScoutEntry;
      for (const [i, col] of OLD_TABLE.columns.entries()) expect(NEW_TABLE.columns[i].getValue(stored), col.key).toEqual(col.getValue(e));
    }
  });

  it("exports byte-identical CSV", () => {
    const entries = legacyEntries(30);
    const name = (n: string) => n;
    expect(entriesToCsv(NEW_TABLE, entries, name)).toBe(entriesToCsv(OLD_TABLE as never, entries, name));
  });

  it("re-imports its own export: same match/team/scout and the same field values (score is recomputed, never trusted)", () => {
    const entries = legacyEntries(25);
    const csv = entriesToCsv(NEW_TABLE, entries, (n) => n);
    const { rows, errors } = parseImportCsv(NEW_TABLE, csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(entries.length);
    rows.forEach((row, i) => {
      const e = entries[i];
      expect([row.matchNumber, row.teamNumber, row.scoutName]).toEqual([e.matchNumber, e.teamNumber, e.scoutName]);
      const values = normalizeValues(BIOBUZZ_FORM, row.values);
      const original = normalizeValues(BIOBUZZ_FORM, entryValues(e, BIOBUZZ_FORM));
      expect(values).toEqual(original);
      expect(calculateScore(BIOBUZZ_FORM, values).total).toBe(e.score.total);
    });
  });

  it("derives the same table twice (it is a pure function of the form)", () => {
    expect(buildGameSchema(BIOBUZZ_FORM).columns.map((c) => c.key)).toEqual(NEW_TABLE_FULL.columns.map((c) => c.key));
    // the one difference from the old table: a derived Notes column, just before the accuracy columns
    expect(NEW_TABLE_FULL.columns.filter((c) => !NEW_TABLE.columns.includes(c)).map((c) => c.key)).toEqual(["stickyNotes"]);
    const keys = NEW_TABLE_FULL.columns.map((c) => c.key);
    expect(keys.indexOf("stickyNotes")).toBe(keys.indexOf("accuracy") - 1);
  });
});

describe("BIOBUZZ regression: flags and stats still read the same entries the same way", () => {
  it("raises the same flags for old-shaped and new-shaped storage of one entry", () => {
    const base = { match: null, allianceTeams: [], officialAllianceScore: 10, allianceAccuracy: null, sameMatchEntries: [], sameTeamEntries: [] };
    for (const e of legacyEntries(40)) {
      const values = normalizeValues(BIOBUZZ_FORM, entryValues(e, BIOBUZZ_FORM));
      const stored = { ...e, ...entryPayloadFor(BIOBUZZ_FORM, values, calculateScore(BIOBUZZ_FORM, values)) } as ScoutEntry;
      expect(evaluateAutoFlagRuleIds(stored, base), e.id).toEqual(evaluateAutoFlagRuleIds(e, base));
    }
  });

  it("computes the same team stats from old-shaped and new-shaped storage", () => {
    const entries = legacyEntries(24).map((e) => ({ ...e, teamNumber: 3468, allianceAccuracy: null, isExcluded: false }));
    const restored = entries.map((e) => {
      const values = normalizeValues(BIOBUZZ_FORM, entryValues(e, BIOBUZZ_FORM));
      return { ...e, ...entryPayloadFor(BIOBUZZ_FORM, values, calculateScore(BIOBUZZ_FORM, values)) };
    });
    const a = buildTeamStats(entries as never, BIOBUZZ_FORM, { teamNumber: 3468, teamName: "Team" });
    const b = buildTeamStats(restored as never, BIOBUZZ_FORM, { teamNumber: 3468, teamName: "Team" });
    expect(b).toEqual(a);
  });
});

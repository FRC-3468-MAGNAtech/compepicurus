import { describe, expect, it } from "vitest";
import { BIOBUZZ_FORM, builtinHash } from "@/lib/forms/builtin";
import { createBlankForm } from "@/lib/forms/new-form";
import { createMemoryFormStore } from "@/lib/forms/store";
import { FormStoreError } from "@/lib/forms/transitions";
import { activeFormIdFor, builtinChangedSince, canBeActive, listFormSummaries, resolveForm, resolveFormForEntry, nextVersion, formDocId } from "@/lib/forms/resolve";
import { exportForm, exportFormJson, importForm } from "@/lib/forms/portable";
import { calculateScore } from "@/lib/forms/scoring";
import { entryValues } from "@/lib/forms/legacy";
import { normalizeValues } from "@/lib/forms/values";
import { buildGameSchema, unionForms } from "@/lib/analytics/game-schema";
import { entriesToCsv, parseImportCsv } from "@/lib/analytics/csv";
import { evaluateAutoFlagRuleIds } from "@/lib/analytics/flags";
import { buildTeamStats } from "@/lib/analytics/team-stats";
import { entryPayloadFor, isScored, type ScoutEntry } from "@/lib/scout-entries";
import { notApplicableAccuracy } from "@/lib/scout-entries";
import { resolveLiveAllianceScoring } from "@/lib/live/scoring";
import type { Form, FormField } from "@/lib/forms/types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const field = (over: Partial<FormField> & Pick<FormField, "key" | "type">): FormField => ({ id: `f-${over.key}`, label: over.key, ...over });

/** A small custom match form: a counter that scores, a rating, a select with points, and a comment. */
function pitForm(over: Partial<Form> = {}): Form {
  const f = createBlankForm({ id: "pit-v1", name: "Pit check", createdBy: "u1" });
  f.sections.find((s) => s.id === "teleop")!.fields.push(
    field({ key: "samples", type: "counter", label: "Samples", min: 0, scoring: { mode: "perTally", value: 3 }, analytics: { include: true, aggregate: "avg" }, unrealisticAbove: 30 }),
    field({ key: "driver", type: "rating", label: "Driver skill", scale: 5, scoring: { mode: "none" }, analytics: { include: true, aggregate: "avg" } }),
    field({
      key: "park",
      type: "select",
      label: "Parked",
      options: [
        { value: "none", label: "Not parked", points: 0 },
        { value: "full", label: "Fully parked", points: 5 },
      ],
      scoring: { mode: "byOption", value: 0 },
      analytics: { include: true },
    }),
    field({ key: "died", type: "toggle", label: "Died", statRoles: ["died", "reliability"], scoring: { mode: "none" }, analytics: { include: true } })
  );
  return { ...f, ...over };
}

const ACTOR = { uid: "admin-1" };
const store = () => {
  let t = 1_000;
  return createMemoryFormStore({ teamId: "team-1", actor: ACTOR, now: () => (t += 10) });
};

describe("form store: custom forms", () => {
  it("saves a draft that scouts can't see yet, then publishes it as version 1", async () => {
    const s = store();
    await s.saveDraft(pitForm());
    expect(await s.getForm("pit-v1")).toBeNull(); // never returns an unpublished draft
    expect((await s.getDraft("pit-v1"))?.name).toBe("Pit check");
    expect((await s.listForms()).find((f) => f.id === "pit-v1")).toMatchObject({ status: "draft", hasDraft: true, version: null });

    const { version } = await s.publish("pit-v1", "first cut");
    expect(version).toBe(1);
    const published = await s.getForm("pit-v1");
    expect(published).toMatchObject({ id: "pit-v1", version: 1, status: "published" });
    expect(await s.getDraft("pit-v1")).toBeNull();
    expect(s.versionDocs()[0]).toMatchObject({ formId: "pit-v1", version: 1, note: "first cut", createdBy: "admin-1" });
  });

  it("keeps every published version immutable and numbers them one past the last", async () => {
    const s = store();
    await s.saveDraft(pitForm());
    await s.publish("pit-v1");
    const v1 = clone(await s.getForm("pit-v1", 1));

    const edited = pitForm({ name: "Pit check (edited)" });
    edited.sections.find((x) => x.id === "teleop")!.fields.find((f) => f.key === "samples")!.scoring = { mode: "perTally", value: 10 };
    await s.saveDraft(edited);
    expect((await s.publish("pit-v1")).version).toBe(2);

    expect(await s.getForm("pit-v1", 1)).toEqual(v1); // untouched
    expect((await s.getForm("pit-v1"))?.version).toBe(2);
    const scoreWith = (form: Form) => calculateScore(form, normalizeValues(form, { samples: 2 })).total;
    expect(scoreWith((await s.getForm("pit-v1", 1))!)).toBe(6);
    expect(scoreWith((await s.getForm("pit-v1", 2))!)).toBe(20);
    expect(s.versionDocs().map((v) => v.version)).toEqual([1, 2]);
  });

  it("refuses to publish with nothing to publish, an unknown form, or blocking problems; the draft stays", async () => {
    const s = store();
    await expect(s.publish("nope")).rejects.toMatchObject({ code: "not-found" });
    await s.saveDraft(pitForm());
    await s.publish("pit-v1");
    await expect(s.publish("pit-v1")).rejects.toMatchObject({ code: "no-draft" });

    const broken = pitForm();
    broken.sections.find((x) => x.id === "teleop")!.fields.push(field({ key: "samples", type: "toggle" })); // duplicate key
    await s.saveDraft(broken); // drafts may have problems
    await expect(s.publish("pit-v1")).rejects.toMatchObject({ code: "not-publishable" });
    expect(await s.getDraft("pit-v1")).not.toBeNull();
    expect((await s.getForm("pit-v1"))?.version).toBe(1); // still the last good one
  });

  it("rejects a structurally invalid form outright", async () => {
    const s = store();
    const bad = clone(pitForm()) as unknown as { sections: { fields: { type: string }[] }[] };
    bad.sections[2].fields[0].type = "hologram";
    await expect(s.saveDraft(bad as unknown as Form)).rejects.toBeInstanceOf(FormStoreError);
  });

  it("archives and un-archives without losing versions", async () => {
    const s = store();
    await s.saveDraft(pitForm());
    await s.publish("pit-v1");
    await s.archive("pit-v1", true);
    expect(canBeActive(s.catalog(), "pit-v1")).toBe(false);
    expect((await s.listForms()).find((f) => f.id === "pit-v1")?.archived).toBe(true);
    expect(await s.getForm("pit-v1", 1)).not.toBeNull(); // old entries still resolve
    await s.archive("pit-v1", false);
    expect(canBeActive(s.catalog(), "pit-v1")).toBe(true);
  });
});

describe("form store: editing a built-in (copy-on-write)", () => {
  const editedBiobuzz = (): Form => {
    const f = clone(BIOBUZZ_FORM);
    f.name = "BIOBUZZ (our scoring)";
    f.sections.flatMap((s) => s.fields).find((x) => x.key === "autoLeave")!.scoring = { mode: "whenOn", value: 10 };
    return f;
  };

  it("leaves scouts on the built-in until the override is published, and numbers it one past the built-in's version", async () => {
    const s = store();
    await s.saveDraft(editedBiobuzz());
    expect((await s.getForm("biobuzz"))?.version).toBe(1); // still the code-defined one
    expect((await s.getForm("biobuzz"))?.name).toBe("BIOBUZZ");
    expect((await s.listForms()).find((f) => f.id === "biobuzz")).toMatchObject({ origin: "built-in-override", hasDraft: true, overridden: false });

    expect((await s.publish("biobuzz")).version).toBe(BIOBUZZ_FORM.version + 1);
    expect((await s.getForm("biobuzz"))?.name).toBe("BIOBUZZ (our scoring)");
    expect((await s.listForms()).find((f) => f.id === "biobuzz")).toMatchObject({ overridden: true, version: 2 });
  });

  it("keeps old entries on the original: version 1 always resolves to the code-defined form", async () => {
    const s = store();
    await s.saveDraft(editedBiobuzz());
    await s.publish("biobuzz");
    const original = await s.getForm("biobuzz", 1);
    expect(original).toBe(BIOBUZZ_FORM);
    const values = normalizeValues(BIOBUZZ_FORM, { autoLeave: true });
    expect(calculateScore(original!, values).total).toBe(calculateScore(BIOBUZZ_FORM, values).total);
    expect(calculateScore((await s.getForm("biobuzz"))!, values).total).toBe(calculateScore(BIOBUZZ_FORM, values).total + 10 - 3 /* the old autoLeave points */);
  });

  it("reset to built-in switches the override off, and its versions stay readable", async () => {
    const s = store();
    await s.saveDraft(editedBiobuzz());
    await s.publish("biobuzz");
    await s.resetToBuiltin("biobuzz");
    expect(await s.getForm("biobuzz")).toBe(BIOBUZZ_FORM);
    expect((await s.getForm("biobuzz", 2))?.name).toBe("BIOBUZZ (our scoring)"); // entries scouted with it still resolve
    expect((await s.listForms()).find((f) => f.id === "biobuzz")?.overridden).toBe(false);
    await expect(s.resetToBuiltin("pit-v1")).rejects.toMatchObject({ code: "unknown-built-in" });
  });

  it("notices when the code-defined original changes after an override was made", async () => {
    const s = store();
    await s.saveDraft(editedBiobuzz());
    const doc = s.catalog().docs.get("biobuzz")!;
    expect(doc.baseBuiltInHash).toBe(builtinHash("biobuzz"));
    expect(builtinChangedSince(doc)).toBe(false);
    expect(builtinChangedSince({ ...doc, baseBuiltInHash: "stale" })).toBe(true);
    expect(builtinChangedSince({ baseBuiltInId: undefined, baseBuiltInHash: undefined })).toBe(false);
  });
});

describe("resolution and the active form per season", () => {
  it("falls back to the season default, and honours the account's choice", () => {
    const season = { id: "biobuzz", formId: "biobuzz" };
    expect(activeFormIdFor(season, undefined)).toBe("biobuzz");
    expect(activeFormIdFor(season, {})).toBe("biobuzz");
    expect(activeFormIdFor(season, { biobuzz: "pit-v1" })).toBe("pit-v1");
  });

  it("only lets a published, unarchived form (or a built-in) be active", async () => {
    const s = store();
    expect(canBeActive(s.catalog(), "biobuzz")).toBe(true);
    expect(canBeActive(s.catalog(), "pit-v1")).toBe(false); // doesn't exist
    await s.saveDraft(pitForm());
    expect(canBeActive(s.catalog(), "pit-v1")).toBe(false); // never published
    await s.publish("pit-v1");
    expect(canBeActive(s.catalog(), "pit-v1")).toBe(true);
  });

  it("resolves an entry's own version, and never fails for a form that exists in code", async () => {
    const s = store();
    const c = s.catalog();
    expect(resolveFormForEntry(c, "biobuzz", 1)).toBe(BIOBUZZ_FORM);
    expect(resolveFormForEntry(c, "biobuzz", 9)).toBe(BIOBUZZ_FORM); // unknown version: the built-in
    expect(resolveFormForEntry(c, "biobuzz")).toBe(BIOBUZZ_FORM); // legacy entry: no version at all
    expect(resolveFormForEntry(c, "gone", 1)).toBeNull();
    expect(resolveForm(c, "gone")).toBeNull();
  });

  it("numbers versions and builds document ids as documented", () => {
    expect(nextVersion(null)).toBe(1);
    expect(nextVersion({ publishedVersion: null, baseBuiltInId: "biobuzz" })).toBe(2);
    expect(nextVersion({ publishedVersion: 4, baseBuiltInId: undefined })).toBe(5);
    expect(formDocId("t", "f")).toBe("t_f");
  });

  it("lists built-ins and custom forms together", async () => {
    const s = store();
    await s.saveDraft(pitForm());
    const list = listFormSummaries(s.catalog());
    // the built-ins (BIOBUZZ and, since P28, Lead Scout, Match Strategy and Drive Reflection) and the custom form
    expect(list.map((f) => f.id).sort()).toEqual(["biobuzz", "drive-reflection-v1", "helper-v1", "lead-scout-v1", "match-strategy-v1", "pit-scout-v1", "pit-v1", "team-strategy-v1"]);
  });
});

describe("export / import", () => {
  it("round-trips a form, stripping everything instance-specific", () => {
    const form = pitForm({ createdBy: "someone", createdAt: 5, updatedAt: 6, version: 3, status: "published" });
    const exported = exportForm(form);
    expect(exported.form).toMatchObject({ version: 0, status: "draft", origin: "custom", createdBy: "" });
    expect(exported.form.createdAt).toBeUndefined();
    const result = importForm(exportFormJson(form));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.form.sections).toEqual(form.sections);
    expect(result.form.name).toBe(form.name);
    expect(result.form.origin).toBe("custom");
  });

  it("exports BIOBUZZ as a portable custom copy (no link to the built-in) that imports cleanly", () => {
    const result = importForm(exportFormJson(BIOBUZZ_FORM));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.form.baseBuiltInId).toBeUndefined();
  });

  it("explains what's wrong instead of importing something half-valid", () => {
    expect(importForm("{not json")).toMatchObject({ ok: false, errors: ["That isn't valid JSON."] });
    expect(importForm("[]")).toMatchObject({ ok: false });
    expect(importForm({ format: "something-else" })).toMatchObject({ ok: false });
    expect(importForm({ format: "compepicurus-form", formatVersion: 99, form: {} })).toMatchObject({ ok: false });
    const bad = exportForm(pitForm());
    (bad.form.sections[2].fields[0] as { type: string }).type = "hologram";
    const r = importForm(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    const dupe = exportForm(pitForm());
    dupe.form.sections[2].fields.push({ ...dupe.form.sections[2].fields[0], id: "other-id" });
    expect(importForm(dupe)).toMatchObject({ ok: false });
  });

  it("collapses whitespace in labels and refuses a file over the size limit", () => {
    const form = pitForm({ name: "Pit      check " });
    const r = importForm(exportFormJson(form));
    expect(r.ok && r.form.name).toBe("Pit check");
    // a newline in a short label is refused outright, not smuggled into the UI
    expect(importForm(exportFormJson(pitForm({ name: "Pit\ncheck" })))).toMatchObject({ ok: false });
    expect(importForm("x".repeat(3_000_000))).toMatchObject({ ok: false });
  });
});

describe("a custom form end to end: scoring, entries, table, CSV, flags, stats", () => {
  const form = (() => {
    const f = pitForm();
    return { ...f, version: 1, status: "published" as const };
  })();

  const entry = (i: number, values: Record<string, unknown>, over: Partial<ScoutEntry> = {}): ScoutEntry => {
    const v = normalizeValues(form, values);
    return {
      id: `c${i}`,
      teamId: "team-1",
      uid: "u1",
      source: "event",
      mode: null,
      scoutName: "Ada",
      eventCode: "EV1",
      matchType: "Qualification",
      matchNumber: i,
      teamNumber: 3468,
      submittedAt: "2026-01-01T00:00:00.000Z",
      excluded: false,
      autoFlags: [],
      manualFlags: [],
      accuracy: null,
      ...entryPayloadFor(form, v, calculateScore(form, v)),
      ...over,
    } as ScoutEntry;
  };

  it("scores the form's own rules (counter x3, option points) and saves values with no legacy `fields`", () => {
    const e = entry(1, { samples: 4, park: "full", driver: 4, comments: "quick" });
    expect(e.score.total).toBe(4 * 3 + 5);
    expect(e.values).toMatchObject({ samples: 4, park: "full", driver: 4 });
    expect(e.fields).toBeUndefined();
    expect(e.formId).toBe("pit-v1");
    expect(e.formVersion).toBe(1);
    expect(e.comments).toBe("quick");
    expect(e.scored).toBeUndefined();
  });

  it("derives table columns, shows option labels, and round-trips through CSV", () => {
    const table = buildGameSchema(form);
    const keys = table.columns.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["match", "team", "scout", "samples", "driver", "park", "died", "scoreTotal", "comments", "accuracy", "actions"]));
    const entries = [entry(1, { samples: 2, park: "full", driver: 5, died: true, comments: "a, b" }), entry(2, { samples: 0, park: "none", driver: 1 })];
    const col = (k: string) => table.columns.find((c) => c.key === k)!;
    expect(col("park").getValue(entries[0])).toBe("Fully parked");
    expect(col("died").getValue(entries[0])).toBe(true);
    const csv = entriesToCsv(table, entries, (n) => n);
    const { rows, errors } = parseImportCsv(table, csv);
    expect(errors).toEqual([]);
    expect(rows.map((r) => normalizeValues(form, r.values))).toEqual(entries.map((e) => normalizeValues(form, entryValues(e, form))));
  });

  it("evaluates flags from the form's roles and limits, not BIOBUZZ's keys", () => {
    const base = { match: null, allianceTeams: [], officialAllianceScore: null, allianceAccuracy: null, sameMatchEntries: [], sameTeamEntries: [], form };
    expect(evaluateAutoFlagRuleIds(entry(1, { samples: 40, park: "full" }), base)).toContain("unrealistic-teleop-scoring");
    expect(evaluateAutoFlagRuleIds(entry(2, { samples: 1 }), base)).not.toContain("unrealistic-teleop-scoring");
    // `died` role: a died robot with no points is not "zero main scoring"
    expect(evaluateAutoFlagRuleIds(entry(3, { died: true }), base)).not.toContain("zero-main-scoring");
    expect(evaluateAutoFlagRuleIds(entry(4, {}), base)).toContain("zero-main-scoring");
  });

  it("computes team stats from the form (average of its scored counter)", () => {
    const entries = [entry(1, { samples: 2 }), entry(2, { samples: 6 })].map((e) => ({ ...e, allianceAccuracy: null, isExcluded: false }));
    const stats = buildTeamStats(entries as never, form, { teamNumber: 3468 });
    expect(stats.avgTotal).toBe(12);
    expect(stats.entryCount ?? entries.length).toBe(2);
  });
});

describe("unioning forms (mixed versions in one table)", () => {
  const v1 = { ...pitForm(), version: 1, status: "published" as const };
  const v2 = (() => {
    const f = clone(v1);
    f.version = 2;
    const teleop = f.sections.find((s) => s.id === "teleop")!;
    teleop.fields = teleop.fields.filter((x) => x.key !== "driver");
    teleop.fields.push(field({ key: "speed", type: "rating", label: "Speed", scale: 5, scoring: { mode: "none" }, analytics: { include: true } }));
    return f;
  })();

  it("has every field either version had, once each, and is the form itself when there's only one", () => {
    expect(unionForms([v1])).toBe(v1);
    const keys = unionForms([v1, v2]).sections.flatMap((s) => s.fields.map((f) => f.key));
    expect(keys).toEqual(expect.arrayContaining(["driver", "speed", "samples"]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reads null (shown as an em dash) for a field an entry's version never recorded", () => {
    const table = buildGameSchema(unionForms([v1, v2]));
    const old = { id: "o", values: { samples: 1, driver: 3 }, score: { auto: 0, teleop: 0, endgame: 0, total: 3 }, comments: "" } as unknown as ScoutEntry;
    const speed = table.columns.find((c) => c.key === "speed")!;
    const driver = table.columns.find((c) => c.key === "driver")!;
    expect(driver.getValue(old)).toBe(3);
    expect(speed.getValue(old)).toBeNull();
  });

  it("reads old values under a renamed key via keyAliases", () => {
    const renamed = clone(v1);
    renamed.version = 2;
    const f = renamed.sections.find((s) => s.id === "teleop")!.fields.find((x) => x.key === "samples")!;
    f.key = "specimens";
    renamed.keyAliases = { samples: "specimens" };
    const old = { values: { samples: 7 }, comments: "" };
    expect(entryValues(old, renamed).specimens).toBe(7);
    const table = buildGameSchema(unionForms([v1, renamed]));
    const keys = table.columns.map((c) => c.key);
    expect(keys).toContain("specimens");
    expect(keys).not.toContain("samples");
  });
});

describe("a form with scoring off", () => {
  const unscored = (() => {
    const f = pitForm({ scoringEnabled: false });
    return { ...f, version: 1, status: "published" as const };
  })();

  it("scores zero, saves entries marked unscored, and has no accuracy columns", () => {
    const v = normalizeValues(unscored, { samples: 9, park: "full" });
    const score = calculateScore(unscored, v);
    expect(score.total).toBe(0);
    const payload = entryPayloadFor(unscored, v, score);
    expect(payload.scored).toBe(false);
    expect(isScored(payload)).toBe(false);
    const keys = buildGameSchema(unscored).columns.map((c) => c.key);
    expect(keys).not.toContain("accuracy");
    expect(keys).not.toContain("scoreTotal");
  });

  it("never raises score-based flags, and its accuracy is n/a rather than an error", () => {
    const v = normalizeValues(unscored, {});
    const e = { id: "u1", ...entryPayloadFor(unscored, v, calculateScore(unscored, v)), teamNumber: 1, scoutName: "A", matchType: "Qualification", matchNumber: 1, eventCode: "EV", autoFlags: [], manualFlags: [], excluded: false, accuracy: null } as unknown as ScoutEntry;
    const ctx = { match: null, allianceTeams: [], officialAllianceScore: 5, allianceAccuracy: null, sameMatchEntries: [], sameTeamEntries: [], form: unscored };
    const flags = evaluateAutoFlagRuleIds(e, ctx);
    expect(flags).not.toContain("zero-main-scoring");
    expect(flags).not.toContain("exceeds-alliance-score");
    expect(flags).not.toContain("statistical-outlier");
    const match = { redTeams: [1, 2], blueTeams: [3, 4], redScore: 20, blueScore: 10, redPenaltyPoints: 0, bluePenaltyPoints: 0 } as never;
    const live = resolveLiveAllianceScoring(match, "red", [e, { ...e, id: "u2", teamNumber: 2 }]);
    expect(live?.sessionAccuracy).toBeNull();
    expect(live?.entryAccuracy).toEqual(notApplicableAccuracy);
  });
});

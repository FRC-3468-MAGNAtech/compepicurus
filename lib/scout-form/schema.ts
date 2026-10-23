import type { ScoreBreakdown, ScoutEntryFields } from "@/lib/scout-entries";

export type ScoutFormFieldType = "toggle" | "counter" | "checkbox" | "pick" | "readonly" | "text";

export type FieldValue = boolean | number | string;
export type FormValues = Record<string, FieldValue>;

export type ScorePhase = "auto" | "teleop" | "endgame";

export type ScoutFormField = {
  key: string;
  type: ScoutFormFieldType;
  label: string;
  /** toggle: points awarded when on. counter: points per tally. Omitted (or 0) for checkbox/pick/readonly/text — those never score. */
  points?: number;
  /** Which score subtotal this field feeds — required for scored (toggle/counter) fields, irrelevant otherwise. */
  phase?: ScorePhase;
  placeholder?: string;
};

export type ScoutFormGroup = { label: string; fields: ScoutFormField[] };

export type ScoutFormSection = {
  id: string;
  label: string;
  /** Either flat fields, or named H2 sub-groups (e.g. Teleop's Hive/Flower/Garden) — not both. */
  fields?: ScoutFormField[];
  groups?: ScoutFormGroup[];
};

export type ScoutFormSchema = {
  id: string;
  version: number;
  name: string;
  sections: ScoutFormSection[];
};

function sectionFields(section: ScoutFormSection): ScoutFormField[] {
  return section.fields ?? section.groups?.flatMap((g) => g.fields) ?? [];
}

export function allFields(schema: ScoutFormSchema): ScoutFormField[] {
  return schema.sections.flatMap(sectionFields);
}

export function defaultValuesForSchema(schema: ScoutFormSchema): FormValues {
  const values: FormValues = {};
  for (const field of allFields(schema)) {
    values[field.key] = field.type === "counter" ? 0 : field.type === "text" ? "" : false;
  }
  return values;
}

/**
 * The single scoring function used everywhere a scout-form schema needs to
 * turn raw field values into a score: the live Scout Form, CSV import, and
 * anywhere later that rescoring an old entry against its stored
 * formId/formVersion is needed. Only `toggle` (points when true) and
 * `counter` (points × tally) fields ever contribute — checkbox incident
 * flags, pick/readonly identity fields, and free text never do, by
 * construction (no `points`/`phase`).
 */
export function calculateScore(schema: ScoutFormSchema, values: FormValues): ScoreBreakdown {
  let auto = 0;
  let teleop = 0;
  let endgame = 0;
  for (const field of allFields(schema)) {
    if (!field.points || !field.phase) continue;
    const value = values[field.key];
    let contribution = 0;
    if (field.type === "toggle" && value === true) contribution = field.points;
    else if (field.type === "counter" && typeof value === "number") contribution = field.points * value;

    if (field.phase === "auto") auto += contribution;
    else if (field.phase === "teleop") teleop += contribution;
    else if (field.phase === "endgame") endgame += contribution;
  }
  return { auto, teleop, endgame, total: auto + teleop + endgame };
}

/**
 * Narrows a schema's generic values down to the strongly-typed
 * ScoutEntryFields shape Firestore stores — safe because BIOBUZZ's scoring
 * field keys are exactly ScoutEntryFields' own property names. A future
 * schema with different field keys would need its own mapping here.
 */
export function valuesToScoutEntryFields(values: FormValues): ScoutEntryFields {
  return {
    autoLeave: Boolean(values.autoLeave),
    autoPark: Boolean(values.autoPark),
    autoTipHive: Number(values.autoTipHive) || 0,
    teleTipHive: Number(values.teleTipHive) || 0,
    flowerBottomNectar: Boolean(values.flowerBottomNectar),
    flowerPollenNectar: Number(values.flowerPollenNectar) || 0,
    gardenPollenNectar: Number(values.gardenPollenNectar) || 0,
    endgamePark: Boolean(values.endgamePark),
    diedDuringMatch: Boolean(values.diedDuringMatch),
    neverStartedMatch: Boolean(values.neverStartedMatch),
    disabledByFtc: Boolean(values.disabledByFtc),
    recoveredFromFreeze: Boolean(values.recoveredFromFreeze),
    tippedOver: Boolean(values.tippedOver),
    yellowCard: Boolean(values.yellowCard),
    redCard: Boolean(values.redCard),
  };
}

export function scoutEntryFieldsToValues(fields: ScoutEntryFields): FormValues {
  return { ...fields };
}

export const BIOBUZZ_FORM_SCHEMA: ScoutFormSchema = {
  id: "biobuzz",
  version: 1,
  name: "BIOBUZZ",
  sections: [
    {
      id: "autonomous",
      label: "Autonomous",
      fields: [
        { key: "autoLeave", type: "toggle", label: "Leave", points: 3, phase: "auto" },
        { key: "autoPark", type: "toggle", label: "Park", points: 5, phase: "auto" },
        { key: "autoTipHive", type: "counter", label: "Tip Hive", points: 20, phase: "auto" },
      ],
    },
    {
      id: "teleop",
      label: "Teleoperated",
      groups: [
        {
          label: "Hive",
          fields: [{ key: "teleTipHive", type: "counter", label: "Tip Hive", points: 20, phase: "teleop" }],
        },
        {
          label: "Flower",
          fields: [
            { key: "flowerBottomNectar", type: "toggle", label: "Bottom Nectar", points: 5, phase: "teleop" },
            { key: "flowerPollenNectar", type: "counter", label: "Pollen and Nectar", points: 2, phase: "teleop" },
          ],
        },
        {
          label: "Garden",
          fields: [{ key: "gardenPollenNectar", type: "counter", label: "Pollen and Nectar", points: 1, phase: "teleop" }],
        },
      ],
    },
    {
      id: "endgame",
      label: "Endgame",
      fields: [{ key: "endgamePark", type: "toggle", label: "Park", points: 5, phase: "endgame" }],
    },
    {
      id: "general",
      label: "General",
      fields: [
        { key: "diedDuringMatch", type: "checkbox", label: "Died During Match" },
        { key: "neverStartedMatch", type: "checkbox", label: "Never Started Match" },
        { key: "disabledByFtc", type: "checkbox", label: "Disabled by FTC" },
        { key: "recoveredFromFreeze", type: "checkbox", label: "Recovered from Freeze" },
        { key: "tippedOver", type: "checkbox", label: "Tipped Over" },
        { key: "yellowCard", type: "checkbox", label: "Yellow Card" },
        { key: "redCard", type: "checkbox", label: "Red Card" },
        {
          key: "comments",
          type: "text",
          label: "Comments",
          placeholder: "Anything notable — robot issues, standout driving, penalties...",
        },
      ],
    },
  ],
};

/** Keyed by formId; each schema carries its own current `version` — see docs/ASSUMPTIONS.md (P2) for why only one version per id is kept today. */
export const FORMS: Record<string, ScoutFormSchema> = {
  biobuzz: BIOBUZZ_FORM_SCHEMA,
};

export const DEFAULT_FORM_ID = "biobuzz";

export function getFormSchema(formId: string = DEFAULT_FORM_ID): ScoutFormSchema {
  return FORMS[formId] ?? BIOBUZZ_FORM_SCHEMA;
}

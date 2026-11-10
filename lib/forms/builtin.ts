import type { Form, FormField, FormSection } from "@/lib/forms/types";
import { formContentHash } from "@/lib/forms/hash";
import { TEAM_BUILTIN_FORMS } from "@/lib/forms/builtin-team-forms";
import { PIT_BUILTIN_FORMS } from "@/lib/forms/builtin-pit-forms";

// P21: the forms that live in code. BIOBUZZ is just the first one: this file is the ONLY place in the app that names a
// game element. It must behave exactly like the pre-v2 hard-coded form (lib/forms/fixtures/biobuzz-v1.ts is the frozen
// original the regression tests compare against: scores, columns, stats, flags).

/** The auto-flag thresholds BIOBUZZ's counters carry (`unrealisticAbove`): the values that used to be hard-coded in lib/analytics/flags.ts. */
const T = { AUTO_TIP_HIVE: 3, TELEOP_TIP_HIVE: 6, FLOWER_POLLEN: 20, GARDEN_POLLEN: 40 } as const;
export const BIOBUZZ_UNREALISTIC = T;

const toggle = (key: string, label: string, points: number, category: string, element: string, extra: Partial<FormField> = {}): FormField => ({
  id: `f-${key}`,
  key,
  type: "toggle",
  label,
  scoring: { mode: "whenOn", value: points },
  analytics: { include: true, category, element, aggregate: "rate" },
  ...extra,
});

const counter = (key: string, label: string, points: number, category: string, element: string, extra: Partial<FormField> = {}): FormField => ({
  id: `f-${key}`,
  key,
  type: "counter",
  label,
  min: 0,
  step: 1,
  scoring: { mode: "perTally", value: points },
  analytics: { include: true, category, element, aggregate: "avg" },
  ...extra,
});

const incident = (key: string, label: string, roles: NonNullable<FormField["statRoles"]> = []): FormField => ({
  id: `f-${key}`,
  key,
  type: "checkbox",
  label,
  scoring: { mode: "none" },
  analytics: { include: true, category: "Incidents", aggregate: "rate" },
  ...(roles.length > 0 ? { statRoles: roles } : {}),
});

const sections: FormSection[] = [
  {
    id: "assigned-match",
    title: "Assigned Match",
    phase: "prematch",
    visible: true,
    fields: [{ id: "sys-match", key: "match", type: "matchPicker", label: "Assigned match", required: true, analytics: { include: true, category: "Information", label: "Match" } }],
  },
  {
    id: "pre-match",
    title: "Pre-Match",
    phase: "prematch",
    visible: true,
    fields: [
      { id: "sys-scout", key: "scoutName", type: "scoutName", label: "Scout name", required: true, analytics: { include: true, category: "Pre-Match", label: "Scout" } },
      { id: "sys-team", key: "teamNumber", type: "teamPicker", label: "Team number", required: true, analytics: { include: true, category: "Information", label: "Team" } },
    ],
  },
  {
    id: "autonomous",
    title: "Autonomous",
    phase: "auto",
    visible: true,
    fields: [
      toggle("autoLeave", "Leave", 3, "Leave", "Leave"),
      toggle("autoPark", "Park", 5, "Park", "Park"),
      counter("autoTipHive", "Tip Hive", 20, "Hive", "Hive", { statRoles: ["primaryScoring"], unrealisticAbove: T.AUTO_TIP_HIVE }),
    ],
  },
  {
    id: "teleop",
    title: "Teleoperated",
    phase: "teleop",
    visible: true,
    groups: [
      { id: "hive", title: "Hive" },
      { id: "flower", title: "Flower" },
      { id: "garden", title: "Garden" },
    ],
    fields: [
      counter("teleTipHive", "Tip Hive", 20, "Hive", "Hive", { groupId: "hive", statRoles: ["primaryScoring"], unrealisticAbove: T.TELEOP_TIP_HIVE }),
      toggle("flowerBottomNectar", "Bottom Nectar", 5, "Flower", "Flower", { groupId: "flower" }),
      counter("flowerPollenNectar", "Pollen and Nectar", 2, "Flower", "Flower", { groupId: "flower", unrealisticAbove: T.FLOWER_POLLEN }),
      counter("gardenPollenNectar", "Pollen and Nectar", 1, "Garden", "Garden", { groupId: "garden", unrealisticAbove: T.GARDEN_POLLEN }),
    ],
  },
  {
    id: "endgame",
    title: "Endgame",
    phase: "endgame",
    visible: true,
    fields: [toggle("endgamePark", "Park", 5, "Park", "Park")],
  },
  {
    id: "general",
    title: "General",
    phase: "misc",
    visible: true,
    fields: [
      incident("diedDuringMatch", "Died During Match", ["reliability", "died"]),
      incident("neverStartedMatch", "Never Started Match", ["reliability", "neverStarted"]),
      incident("disabledByFtc", "Disabled by FTC", ["reliability", "disabled"]),
      incident("recoveredFromFreeze", "Recovered from Freeze", ["reliability", "recoveredFromFreeze"]),
      incident("tippedOver", "Tipped Over", ["reliability"]),
      incident("yellowCard", "Yellow Card"),
      incident("redCard", "Red Card"),
      {
        id: "f-comments",
        key: "comments",
        type: "textarea",
        label: "Comments",
        placeholder: "Anything notable — robot issues, standout driving, penalties...",
        statRoles: ["comments"],
        scoring: { mode: "none" },
        analytics: { include: true, category: "Comments", aggregate: "list" },
      },
    ],
  },
];

export const BIOBUZZ_FORM: Form = {
  id: "biobuzz",
  name: "BIOBUZZ",
  description: "The 2026 BIOBUZZ season's match scouting form: Hive, Flower and Garden scoring, parking, and incident flags.",
  formType: "match-scout",
  tags: ["biobuzz", "2026"],
  version: 1,
  status: "published",
  scoringEnabled: true,
  sections,
  // P28: the sticky notes panel is on for the Match Scout Form by default (its notes are saved with the entry and fold into the old Comments column)
  stickyNotes: { enabled: true, defaultOpen: false },
  origin: "built-in",
  createdBy: "system",
};

/** Every form defined in code, by id. An account's override (copy-on-write) of one of these lives in Firestore and wins when it exists. */
export const BUILTIN_FORMS: Readonly<Record<string, Form>> = { biobuzz: BIOBUZZ_FORM, ...TEAM_BUILTIN_FORMS, ...PIT_BUILTIN_FORMS };

export const DEFAULT_FORM_ID = "biobuzz";

export function getBuiltinForm(id: string): Form | null {
  return BUILTIN_FORMS[id] ?? null;
}

/** Content hash of a built-in, stored on an override so a later change to the code-defined original can be detected. */
export function builtinHash(id: string): string | null {
  const form = BUILTIN_FORMS[id];
  return form ? formContentHash(form) : null;
}

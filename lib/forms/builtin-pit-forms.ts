import { systemFieldsFor } from "@/lib/forms/new-form";
import type { Form, FormField } from "@/lib/forms/types";

// P29: the team-based forms (Pit Scout, Team Strategy, Helper), built-in and built from the schema. One entry is about one TEAM at one event (the team picker is the
// locked system field). None scores; all have the sticky notes panel on. Adding a field later (a starting position, another auto step) is a builder edit: nothing
// here is special-cased by key except the robot weight's unit and the rookie suggestion on the page.

const base = { tags: [] as string[], version: 1, status: "published" as const, scoringEnabled: false, origin: "built-in" as const, createdBy: "system" };

/** The auto cycle's steps. Leave is always first and Park always last (pinned, once); the others repeat and can be rearranged. More steps can be added in the builder. */
export const PIT_AUTO_STEPS = [
  { id: "leave", label: "Leave", maxCount: 1, pin: "first" },
  { id: "hive", label: "Score Into Hive", shortLabel: "Hive", maxCount: 0, pin: null },
  { id: "garden", label: "Grab Pollen/Nectar From Garden", shortLabel: "Garden", maxCount: 0, pin: null },
  { id: "flower", label: "Grab Pollen/Nectar From Flower", shortLabel: "Flower", maxCount: 0, pin: null },
  { id: "park", label: "Park", maxCount: 1, pin: "last" },
] as const;

const pickers = (...types: ("eventPicker" | "teamPicker" | "scoutName")[]): FormField[] => {
  const all = systemFieldsFor("pit-scout");
  return types.map((t) => all.find((f) => f.type === t)!);
};

const plain = (extra: Partial<FormField> & Pick<FormField, "id" | "key" | "type" | "label">): FormField => ({ scoring: { mode: "none" }, analytics: { include: true }, ...extra });
const checkbox = (id: string, key: string, label: string): FormField => plain({ id, key, type: "checkbox", label, analytics: { include: true, aggregate: "rate" } });
const numberField = (id: string, key: string, label: string, extra: Partial<FormField> = {}): FormField => plain({ id, key, type: "number", label, min: 0, decimals: 0, analytics: { include: true, aggregate: "avg" }, ...extra });

export const PIT_SCOUT_FORM: Form = {
  ...base,
  id: "pit-scout-v1",
  name: "Pit Scout",
  description: "A team's robot as seen in the pit: weight, photos, capabilities, capacity, cycle time and the planned auto cycle.",
  formType: "pit-scout",
  tags: ["pit-scout"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: pickers("eventPicker", "teamPicker", "scoutName") },
    {
      id: "robot",
      title: "Robot",
      phase: "misc",
      visible: true,
      fields: [
        numberField("f-weight", "weight", "Robot weight", { decimals: 1, placeholder: "e.g. 24.5", analytics: { include: true, aggregate: "avg", category: "Robot" } }),
        plain({
          id: "f-weight-unit",
          key: "weightUnit",
          type: "radio",
          label: "Weight unit",
          default: "lb",
          options: [
            { value: "lb", label: "lb" },
            { value: "kg", label: "kg" },
          ],
          analytics: { include: true, aggregate: "last", category: "Robot" },
        }),
        checkbox("f-rookie", "rookie", "Rookie team"),
        plain({ id: "f-photos", key: "photos", type: "image", label: "Photo of the robot", maxCount: 3, capture: true, analytics: { include: true, aggregate: "list", category: "Robot" } }),
        checkbox("f-friendly-pit", "friendlyPit", "Friendly and easy to work with in the pit"),
        checkbox("f-friendly-drive", "friendlyDrive", "Friendly and easy to work with in drive"),
      ],
    },
    {
      id: "capabilities",
      title: "Capabilities",
      phase: "misc",
      visible: true,
      fields: [
        plain({
          id: "f-capabilities",
          key: "capabilities",
          type: "matrix",
          label: "What the robot can do",
          rows: [
            { key: "leave", label: "Leave" },
            { key: "park", label: "Park" },
            { key: "hive", label: "Score into Hive" },
            { key: "garden", label: "Score into Garden" },
            { key: "flower", label: "Score into Flower" },
          ],
          cols: [
            { key: "auto", label: "Autonomous" },
            { key: "teleop", label: "Teleop/Endgame" },
          ],
          disabledCells: ["leave_teleop"], // Leave is an Autonomous-only action
          analytics: { include: true, aggregate: "rate", category: "Capabilities" },
        }),
        numberField("f-capacity", "capacity", "Approximately how many pollen/nectar can the robot hold in total?", { analytics: { include: true, aggregate: "avg", category: "Capacity" } }),
        numberField("f-preloaded", "preloaded", "Approximately how many are preloaded?", { analytics: { include: true, aggregate: "avg", category: "Capacity" } }),
        numberField("f-cycle-time", "cycleTime", "Approximate cycle time (seconds)", { decimals: 1, placeholder: "seconds", analytics: { include: true, aggregate: "avg", category: "Capacity" } }),
      ],
    },
    {
      id: "auto-cycle",
      title: "Auto cycle",
      phase: "auto",
      visible: true,
      fields: [plain({ id: "f-auto-cycle", key: "autoCycle", type: "sequence", label: "Auto cycle outliner", helpText: "Tap the steps in the order the robot does them. Leave is always first and Park always last.", steps: PIT_AUTO_STEPS.map((s) => ({ ...s })), analytics: { include: true, aggregate: "last", category: "Auto cycle" } })],
    },
  ],
};

export const TEAM_STRATEGY_FORM: Form = {
  ...base,
  id: "team-strategy-v1",
  name: "Team Strategy",
  description: "What a team is best at and what it can do, from a strategist's point of view.",
  formType: "team-strategy",
  tags: ["strategy"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: pickers("eventPicker", "teamPicker", "scoutName") },
    {
      id: "strategy",
      title: "Strategy",
      phase: "misc",
      visible: true,
      fields: [
        plain({
          id: "f-best-at",
          key: "bestAt",
          type: "select",
          label: "Best at",
          placeholder: "Choose one",
          options: [
            { value: "hive", label: "Hive" },
            { value: "flower", label: "Flower" },
            { value: "garden", label: "Garden" },
            { value: "gathering", label: "Gathering" },
            { value: "defense", label: "Defense" },
          ],
          analytics: { include: true, aggregate: "last", category: "Strategy" },
        }),
        checkbox("f-can-hive", "canScoreHive", "Can score in Hive"),
        checkbox("f-can-flower", "canScoreFlower", "Can score in Flower"),
        checkbox("f-shoot-intaking", "shootWhileIntaking", "Shoot while intaking"),
        checkbox("f-shoot-moving", "shootWhileMoving", "Shoot while moving"),
      ],
    },
  ],
};

export const HELPER_FORM: Form = {
  ...base,
  id: "helper-v1",
  name: "Helper",
  description: "For people who help other teams in the pit: which team, whether the help worked, and what the issue was.",
  formType: "helper",
  tags: ["helper"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    {
      id: "pre-match",
      title: "Pre-Match",
      phase: "prematch",
      visible: true,
      fields: pickers("eventPicker", "teamPicker", "scoutName").map((f) => (f.type === "teamPicker" ? { ...f, label: "Team helped" } : f)),
    },
    {
      id: "assist",
      title: "The assist",
      phase: "misc",
      visible: true,
      fields: [
        plain({
          id: "f-successful",
          key: "successful",
          type: "radio",
          label: "Was the scout successful with the pit assistance?",
          required: true,
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
          analytics: { include: true, aggregate: "last", category: "Assist" },
        }),
        plain({ id: "f-issues", key: "issues", type: "textarea", label: "Issue(s) they attempted to solve", required: true, placeholder: "What was wrong, and what did you try?", analytics: { include: true, aggregate: "list", category: "Assist" } }),
      ],
    },
  ],
};

export const PIT_BUILTIN_FORMS: Readonly<Record<string, Form>> = {
  [PIT_SCOUT_FORM.id]: PIT_SCOUT_FORM,
  [TEAM_STRATEGY_FORM.id]: TEAM_STRATEGY_FORM,
  [HELPER_FORM.id]: HELPER_FORM,
};

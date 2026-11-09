import { SYSTEM_FIELD_KEYS, type Form, type FormField, type FormGroup, type FormSection } from "@/lib/forms/types";
import { systemFieldsFor } from "@/lib/forms/new-form";

// P28: the team's three match-based forms, built-in and built from the schema (not custom pages): Lead Scout, Match Strategy and Drive Reflection. Each has its own
// page (gated by P26's page access), saves to `formEntries` (P27) and is an editable default in the Form Builder (copy-on-write, like BIOBUZZ). None scores.
// Alliances are drawn from the schedule: 2 teams in a qualification, up to 3 on a playoff alliance, so a group repeats per team (`maxSlots: 3`).

const REPEAT_GROUP: FormGroup = { id: "teams-group", title: "Teams", repeat: { source: "allianceTeams", maxSlots: 3 } };

/** The pickers in the order the page asks them: event, then (for strategy and reflection) alliance, match, scout. */
function pickers(order: ("eventPicker" | "matchPicker" | "alliancePicker" | "scoutName")[]): FormField[] {
  const all = systemFieldsFor("lead-scout");
  return order.map((t) => all.find((f) => f.type === t)!);
}

const skill = (id: string, key: string, label: string, groupId?: string): FormField => ({
  id,
  key,
  type: "slider",
  label,
  min: 1,
  max: 5,
  step: 1,
  ticks: true,
  endLabels: { min: "Low", max: "High" },
  scoring: { mode: "none" },
  analytics: { include: true, aggregate: "avg" },
  ...(groupId ? { groupId } : {}),
});

const notes = (id: string, key: string, label: string, groupId?: string): FormField => ({
  id,
  key,
  type: "textarea",
  label,
  placeholder: "What did you see?",
  scoring: { mode: "none" },
  analytics: { include: true, aggregate: "list" },
  ...(groupId ? { groupId } : {}),
});

const teamPicker = (id: string): FormField => ({ id, key: "team", type: "teamPicker", label: "Team", groupId: REPEAT_GROUP.id, scoring: { mode: "none" }, analytics: { include: true, aggregate: "last" } });

const roleField = (id: string, label: string): FormField => ({
  id,
  key: "role",
  type: "select",
  label,
  groupId: REPEAT_GROUP.id,
  options: [
    { value: "hive", label: "Hive" },
    { value: "flower", label: "Flower" },
    { value: "garden", label: "Garden" },
    { value: "gathering", label: "Gathering" },
    { value: "defense", label: "Defense" },
  ],
  scoring: { mode: "none" },
  analytics: { include: true, aggregate: "last" },
});

const autoField = (id: string, label: string): FormField => ({ id, key: "auto", type: "checkbox", label, groupId: REPEAT_GROUP.id, scoring: { mode: "none" }, analytics: { include: true, aggregate: "rate" } });

const base = { tags: [] as string[], version: 1, status: "published" as const, scoringEnabled: false, origin: "built-in" as const, createdBy: "system" };

/** Lead Scout: an alliance box (notes and a 1-5 skill) and one box per team (team selector, notes, 1-5 skill). */
export const LEAD_SCOUT_FORM: Form = {
  ...base,
  id: "lead-scout-v1",
  name: "Lead Scout",
  description: "A lead scout's read of an alliance in a match: notes and a 1-5 skill level for the alliance and for each of its teams.",
  formType: "lead-scout",
  tags: ["lead-scout"],
  sections: [
    { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: pickers(["eventPicker", "matchPicker", "alliancePicker", "scoutName"]) },
    { id: "alliance", title: "Alliance", phase: "misc", visible: true, fields: [notes("f-alliance-notes", "allianceNotes", "Notes"), skill("f-alliance-skill", "allianceSkill", "Skill level")] },
    {
      id: "teams",
      title: "Teams",
      phase: "misc",
      visible: true,
      groups: [REPEAT_GROUP],
      fields: [teamPicker("f-team"), notes("f-team-notes", "notes", "Notes", REPEAT_GROUP.id), skill("f-team-skill", "skill", "Skill level", REPEAT_GROUP.id)],
    },
  ],
};

const strategySections = (roleLabel: string, autoLabel: string): FormSection[] => [
  { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: pickers(["eventPicker", "alliancePicker", "matchPicker", "scoutName"]) },
  { id: "teams", title: "Teams", phase: "misc", visible: true, groups: [REPEAT_GROUP], fields: [teamPicker("f-team"), roleField("f-role", roleLabel), autoField("f-auto", autoLabel)] },
];

/** Match Strategy: the plan, made before the match: each team's role and whether it will score in auto. */
export const MATCH_STRATEGY_FORM: Form = {
  ...base,
  id: "match-strategy-v1",
  name: "Match Strategy",
  description: "The plan for a match, made before it: each team's role and whether it will score in auto.",
  formType: "match-strategy",
  tags: ["strategy"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: strategySections("Role", "Will score in auto"),
};

/** Drive Reflection: the same questions after the match, prefilled from the plan, with every difference marked. */
export const DRIVE_REFLECTION_FORM: Form = {
  ...base,
  id: "drive-reflection-v1",
  name: "Drive Reflection",
  description: "What actually happened, recorded after the match. Prefilled from the Match Strategy for the same event, match and alliance, with differences marked.",
  formType: "drive-reflection",
  tags: ["reflection"],
  stickyNotes: { enabled: true, defaultOpen: false },
  compareWith: { formId: "match-strategy-v1", matchOn: ["eventCode", "matchKey", "alliance"], fieldMap: { role: "role", auto: "auto" } },
  sections: strategySections("Role", "Scored in auto"),
};

export const TEAM_BUILTIN_FORMS: Readonly<Record<string, Form>> = {
  [LEAD_SCOUT_FORM.id]: LEAD_SCOUT_FORM,
  [MATCH_STRATEGY_FORM.id]: MATCH_STRATEGY_FORM,
  [DRIVE_REFLECTION_FORM.id]: DRIVE_REFLECTION_FORM,
};

// The data keys the pages rely on (kept next to the definitions so a rename here is one change).
export const TEAM_FORM_KEYS = SYSTEM_FIELD_KEYS;

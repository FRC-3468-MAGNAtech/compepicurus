import type { FormEntryType } from "@/lib/form-entries-model";

// The form types the Scout Status page covers (P16, extended by P30). Each entry says what one "unit" of scouting is and how targets work, so a new form type plugs in
// by editing this registry and (for a new kind of unit) lib/scout-status/form-status.ts.
//
//  - "robot-match": Match Scout: one robot in one match (the original page, unchanged).
//  - "match-alliance": Lead Scout, Match Strategy, Drive Reflection: one alliance (Red or Blue) in one match.
//  - "team": Pit Scout, Team Strategy: one team at the event; targets are teams per scout.
//  - "count": Helper: no units, only how many each person logged.

export type ScoutStatusFormTypeId = "match-scout" | "lead-scout" | "pit-scout" | "team-strategy" | "match-strategy" | "drive-reflection" | "helper";

export type StatusUnit = "robot-match" | "match-alliance" | "team" | "count";

export type ScoutStatusFormType = {
  id: ScoutStatusFormTypeId;
  label: string;
  enabled: boolean;
  /** What one unit of "scouted" is, in words (shown in the page's help text). */
  scoutedUnit: string;
  unit: StatusUnit;
  /** The `formEntries` type (null for Match Scout, whose entries live in scoutEntries). */
  formType: FormEntryType | null;
  /** How targets are set for this form type. */
  targets: "per-category-per-scout" | "teams-per-scout" | "none";
  /** The P26 page id whose access makes someone an eligible scout for this form. */
  pageId: string | null;
};

export const scoutStatusFormTypes: ScoutStatusFormType[] = [
  { id: "match-scout", label: "Match Scout", enabled: true, scoutedUnit: "One entry for one robot in one match", unit: "robot-match", formType: null, targets: "per-category-per-scout", pageId: null },
  { id: "lead-scout", label: "Lead Scout", enabled: true, scoutedUnit: "One entry for one alliance (Red or Blue) in one match", unit: "match-alliance", formType: "lead-scout", targets: "per-category-per-scout", pageId: "lead-scout-form" },
  { id: "pit-scout", label: "Pit Scout", enabled: true, scoutedUnit: "One entry for one team at the event", unit: "team", formType: "pit-scout", targets: "teams-per-scout", pageId: "pit-scout-form" },
  { id: "team-strategy", label: "Team Strategy", enabled: true, scoutedUnit: "One entry for one team at the event", unit: "team", formType: "team-strategy", targets: "teams-per-scout", pageId: "team-strategy-form" },
  { id: "match-strategy", label: "Match Strategy", enabled: true, scoutedUnit: "One plan for one alliance in one match", unit: "match-alliance", formType: "match-strategy", targets: "per-category-per-scout", pageId: "match-strategy-form" },
  { id: "drive-reflection", label: "Drive Reflection", enabled: true, scoutedUnit: "One reflection for one alliance in one match", unit: "match-alliance", formType: "drive-reflection", targets: "per-category-per-scout", pageId: "drive-reflection-form" },
  { id: "helper", label: "Helper", enabled: true, scoutedUnit: "One pit assist logged", unit: "count", formType: "helper", targets: "none", pageId: "helper-form" },
];

export const DEFAULT_FORM_TYPE: ScoutStatusFormTypeId = "match-scout";

export const scoutStatusFormType = (id: string): ScoutStatusFormType => scoutStatusFormTypes.find((t) => t.id === id) ?? scoutStatusFormTypes[0];

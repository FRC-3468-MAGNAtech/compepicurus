// The form types the Scout Status page is built around (P16). Only Match Scout is
// built; the rest are listed so the selector shows what's coming and so a future
// form type plugs in by editing this registry — each entry says what counts as
// "scouted" and how targets work. Nothing is built for the disabled ones.

export type ScoutStatusFormTypeId = "match-scout" | "lead-scout" | "pit-scout" | "team-strategy" | "match-strategy" | "drive-reflection" | "helper";

export type ScoutStatusFormType = {
  id: ScoutStatusFormTypeId;
  label: string;
  enabled: boolean;
  /** What one unit of "scouted" is, in words (shown in the page's help text). */
  scoutedUnit: string;
  /** How targets are set for this form type. */
  targets: "per-category-per-scout" | "none";
};

export const scoutStatusFormTypes: ScoutStatusFormType[] = [
  { id: "match-scout", label: "Match Scout", enabled: true, scoutedUnit: "One entry for one robot in one match", targets: "per-category-per-scout" },
  { id: "lead-scout", label: "Lead Scout", enabled: false, scoutedUnit: "", targets: "none" },
  { id: "pit-scout", label: "Pit Scout", enabled: false, scoutedUnit: "", targets: "none" },
  { id: "team-strategy", label: "Team Strategy", enabled: false, scoutedUnit: "", targets: "none" },
  { id: "match-strategy", label: "Match Strategy", enabled: false, scoutedUnit: "", targets: "none" },
  { id: "drive-reflection", label: "Drive Reflection", enabled: false, scoutedUnit: "", targets: "none" },
  { id: "helper", label: "Helper", enabled: false, scoutedUnit: "", targets: "none" },
];

export const DEFAULT_FORM_TYPE: ScoutStatusFormTypeId = "match-scout";

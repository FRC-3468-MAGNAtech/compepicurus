import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { DRIVE_REFLECTION_FORM, LEAD_SCOUT_FORM, MATCH_STRATEGY_FORM } from "@/lib/forms/builtin-team-forms";
import { HELPER_FORM, PIT_SCOUT_FORM, TEAM_STRATEGY_FORM } from "@/lib/forms/builtin-pit-forms";
import { createBlankForm } from "@/lib/forms/new-form";
import type { Form } from "@/lib/forms/types";
import { buildTemplateContent, type TemplateContent } from "@/lib/templates/build";

// P23: the templates we ship. A platform owner publishes them with "Seed official templates" (Admin Panel > Template Review): they are created from the
// built-in BIOBUZZ form and from the blank starter, public and marked official, under the author name "CompEpicurus". Seeding again only adds a new
// version when the content has changed (accounts that used the template then see "Update available").

export const OFFICIAL_AUTHOR = "CompEpicurus";

export type OfficialTemplate = { id: string; content: TemplateContent };

function blankStarter(): Form {
  // Scoring is off: a blank form has nothing that scores yet, and a form that scores but doesn't would be unpublishable. Turn it on in Form settings.
  return { ...createBlankForm({ id: "blank", name: "Blank (standard phases)", createdBy: "", description: "Pre-Match, Autonomous, Teleoperated, Endgame and Misc, with the locked system fields. Scoring is off: turn it on in Form settings when you add points." }), scoringEnabled: false, tags: ["starter"] };
}

export function officialTemplates(): OfficialTemplate[] {
  const biobuzz = buildTemplateContent({ form: BIOBUZZ_FORM, name: "BIOBUZZ Match Scout", description: "The official 2026 BIOBUZZ match scouting form: Hive, Flower and Garden scoring, parking, and incident flags.", tags: ["biobuzz", "2026", "match scout", "official"] });
  const blank = buildTemplateContent({ form: blankStarter(), name: "Blank (standard phases)", description: "The five standard categories and the locked system fields, ready to build on. Scoring is off until you turn it on.", tags: ["starter", "blank"] });
  // P28: the three match-based forms are public templates too, so another account can start from them
  const lead = buildTemplateContent({ form: LEAD_SCOUT_FORM, name: "Lead Scout", description: LEAD_SCOUT_FORM.description, tags: ["lead scout", "alliance", "official"] });
  const strategy = buildTemplateContent({ form: MATCH_STRATEGY_FORM, name: "Match Strategy", description: MATCH_STRATEGY_FORM.description, tags: ["strategy", "alliance", "official"] });
  const reflection = buildTemplateContent({ form: DRIVE_REFLECTION_FORM, name: "Drive Reflection", description: DRIVE_REFLECTION_FORM.description, tags: ["reflection", "alliance", "official"] });
  // P29: the team-based forms too
  const pit = buildTemplateContent({ form: PIT_SCOUT_FORM, name: "Pit Scout", description: PIT_SCOUT_FORM.description, tags: ["pit scout", "team", "official"] });
  const teamStrategy = buildTemplateContent({ form: TEAM_STRATEGY_FORM, name: "Team Strategy", description: TEAM_STRATEGY_FORM.description, tags: ["strategy", "team", "official"] });
  const helper = buildTemplateContent({ form: HELPER_FORM, name: "Helper", description: HELPER_FORM.description, tags: ["helper", "team", "official"] });
  const all = [biobuzz, blank, lead, strategy, reflection, pit, teamStrategy, helper];
  const failed = all.flatMap((r) => (r.ok ? [] : r.errors));
  if (failed.length > 0) throw new Error(`The official templates must be valid: ${failed.join("; ")}`);
  const content = (r: (typeof all)[number]) => (r as { ok: true; content: TemplateContent }).content;
  return [
    { id: "official-biobuzz", content: content(biobuzz) },
    { id: "official-blank", content: content(blank) },
    { id: "official-lead-scout", content: content(lead) },
    { id: "official-match-strategy", content: content(strategy) },
    { id: "official-drive-reflection", content: content(reflection) },
    { id: "official-pit-scout", content: content(pit) },
    { id: "official-team-strategy", content: content(teamStrategy) },
    { id: "official-helper", content: content(helper) },
  ];
}

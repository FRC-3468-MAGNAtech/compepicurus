import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
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
  if (!biobuzz.ok || !blank.ok) throw new Error(`The official templates must be valid: ${[...(biobuzz.ok ? [] : biobuzz.errors), ...(blank.ok ? [] : blank.errors)].join("; ")}`);
  return [
    { id: "official-biobuzz", content: biobuzz.content },
    { id: "official-blank", content: blank.content },
  ];
}

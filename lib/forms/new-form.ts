import type { Form, FormField, FormSection } from "@/lib/forms/types";

/** The locked system fields of a match-scout form. Required, can be moved within Pre-Match, never deleted or retyped. Their keys are fixed (`match`, `scoutName`, `teamNumber`): they live on the entry itself, not in its values. */
export function systemFields(): FormField[] {
  return [
    { id: "sys-match", key: "match", type: "matchPicker", label: "Assigned match", required: true, analytics: { include: true, category: "Information", label: "Match" } },
    { id: "sys-scout", key: "scoutName", type: "scoutName", label: "Scout name", required: true, analytics: { include: true, category: "Pre-Match", label: "Scout" } },
    { id: "sys-team", key: "teamNumber", type: "teamPicker", label: "Team number", required: true, analytics: { include: true, category: "Information", label: "Team" } },
  ];
}

/** A new form starts with the five standard categories, the locked system fields in Pre-Match, and a comments field in Misc. */
export function createBlankForm(input: { id: string; name: string; createdBy: string; description?: string; now?: number }): Form {
  const sections: FormSection[] = [
    { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: systemFields() },
    { id: "autonomous", title: "Autonomous", phase: "auto", visible: true, fields: [] },
    { id: "teleop", title: "Teleoperated", phase: "teleop", visible: true, fields: [] },
    { id: "endgame", title: "Endgame", phase: "endgame", visible: true, fields: [] },
    {
      id: "misc",
      title: "Misc",
      phase: "misc",
      visible: true,
      fields: [
        {
          id: "f-comments",
          key: "comments",
          type: "textarea",
          label: "Comments",
          placeholder: "Anything notable",
          statRoles: ["comments"],
          scoring: { mode: "none" },
          analytics: { include: true, category: "Comments", aggregate: "list" },
        },
      ],
    },
  ];
  return {
    id: input.id,
    name: input.name.trim() || "Untitled form",
    description: input.description ?? "",
    formType: "match-scout",
    tags: [],
    version: 0,
    status: "draft",
    scoringEnabled: true,
    sections,
    origin: "custom",
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** A URL/doc-safe id from a name: lowercase, hyphens, bounded; `taken` ids get a numeric suffix. */
export function slugifyFormId(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "form";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

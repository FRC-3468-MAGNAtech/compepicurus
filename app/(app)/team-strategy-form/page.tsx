"use client";

import { FormPage } from "@/components/forms/form-page-connected";

// P29: a built-in, schema-driven form page (see lib/forms/builtin-pit-forms.ts). Gated by P26's page access through the route guard.
export default function Page() {
  return <FormPage formId="team-strategy-v1" title="Team Strategy Form" subtitle="What a team is best at and what it can do." assignmentKind="teamStrategy" />;
}

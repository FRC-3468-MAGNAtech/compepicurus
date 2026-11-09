"use client";

import { FormPage } from "@/components/forms/form-page-connected";

// P28: a built-in, schema-driven form page (see lib/forms/builtin-team-forms.ts). Gated by P26's page access through the route guard.
export default function Page() {
  return <FormPage formId="lead-scout-v1" title="Lead Scout Form" subtitle="Read an alliance in a match: notes and a skill level for the alliance and each team." />;
}

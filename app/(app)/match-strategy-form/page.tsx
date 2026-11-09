"use client";

import { FormPage } from "@/components/forms/form-page-connected";

// P28: a built-in, schema-driven form page (see lib/forms/builtin-team-forms.ts). Gated by P26's page access through the route guard.
export default function Page() {
  return <FormPage formId="match-strategy-v1" title="Match Strategy Form" subtitle="The plan before the match: each team's role and whether it will score in auto." />;
}

"use client";

import { FormPage } from "@/components/forms/form-page-connected";

// P28: a built-in, schema-driven form page (see lib/forms/builtin-team-forms.ts). Gated by P26's page access through the route guard.
export default function Page() {
  return <FormPage formId="drive-reflection-v1" title="Drive Reflection Form" subtitle="What actually happened, after the match. Prefilled from the plan, with differences marked." />;
}

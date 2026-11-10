"use client";

import { FormPage } from "@/components/forms/form-page-connected";

// P29: a built-in, schema-driven form page (see lib/forms/builtin-pit-forms.ts). Gated by P26's page access through the route guard.
export default function Page() {
  return <FormPage formId="pit-scout-v1" title="Pit Scout Form" subtitle="A team's robot as seen in the pit: photos, capabilities, capacity and the auto cycle." photoKind="pit" assignmentKind="pit" />;
}

"use client";

import { FormPage } from "@/components/forms/form-page-connected";

// P29: a built-in, schema-driven form page (see lib/forms/builtin-pit-forms.ts). Gated by P26's page access through the route guard.
export default function Page() {
  return <FormPage formId="helper-v1" title="Helper Form" subtitle="Log helping another team in the pit." hideEventPickerIfSingle />;
}

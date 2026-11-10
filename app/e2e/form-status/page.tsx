import { notFound } from "next/navigation";
import { FormStatusFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/form-status.e2e.ts, P30): the real FormStatusView for each form type, on seeded inputs run through the pure
// Scout Status logic. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts).
export const dynamic = "force-dynamic";

export default function FormStatusPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <FormStatusFixture />;
}

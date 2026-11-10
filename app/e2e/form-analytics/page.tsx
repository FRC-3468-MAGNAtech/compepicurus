import { notFound } from "next/navigation";
import { FormAnalyticsFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/form-analytics.e2e.ts, P30): the real FormAnalyticsView for each of the six new forms' Analytics pages, on seeded
// in-memory entries, with admin actions applied to that memory. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts).
export const dynamic = "force-dynamic";

export default function FormAnalyticsPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <FormAnalyticsFixture />;
}

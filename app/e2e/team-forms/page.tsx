import { notFound } from "next/navigation";
import { TeamFormsFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/team-forms.e2e.ts, P29): the real FormPageView for the Pit Scout, Team Strategy and Helper forms, with a fake photo
// uploader that fails while the browser is offline, in-memory entries, assigned teams and FIRST rookie data. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts).
export const dynamic = "force-dynamic";

export default function TeamFormsPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <TeamFormsFixture />;
}

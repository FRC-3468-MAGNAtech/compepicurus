import { notFound } from "next/navigation";
import { FormPageFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/form-page.e2e.ts, P28): the real FormPageView (Lead Scout, Match Strategy, Drive Reflection) and the sticky notes
// panel on a fixed schedule, with no login and no Firestore. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts sets it for its own server).
export const dynamic = "force-dynamic";

export default function FormPageFixturePage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <FormPageFixture />;
}

import { notFound } from "next/navigation";
import { EventPanelFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/event-panel.e2e.ts, FIX4): the real Selected events panel (drag and drop, arrows, the star, the condensed
// bar) on fixed events held in memory, with no login and no Firestore. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts sets it for its own server).
export const dynamic = "force-dynamic";

export default function EventPanelPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <EventPanelFixture />;
}

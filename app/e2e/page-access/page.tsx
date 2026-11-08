import { notFound } from "next/navigation";
import { PageAccessFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/page-access.e2e.ts, P26): the real Page Access panel and the no-access screen on in-memory data, with no login and
// no Firestore. (What the rules allow is proved by the emulator tests.) A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts sets it for its own server).
export const dynamic = "force-dynamic";

export default function PageAccessFixturePage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <PageAccessFixture />;
}

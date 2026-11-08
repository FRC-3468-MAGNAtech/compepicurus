import { notFound } from "next/navigation";
import { MatchListFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/match-list.e2e.ts, FIX4): the real Match List screen on a fixed schedule with a fixed clock, no login and no
// FIRST API. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts sets it for its own server).
export const dynamic = "force-dynamic";

export default function MatchListFixturePage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <MatchListFixture />;
}

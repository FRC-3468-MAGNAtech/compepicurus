import { notFound } from "next/navigation";
import { ProfilesFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/profiles.e2e.ts, P25): the real profile screen, header, activity sections and Settings editor on fixed data, with no
// login and no Firestore. (What the database allows is proved by the emulator rules tests.) A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts sets it for its own
// server), so it does nothing in production.
export const dynamic = "force-dynamic";

export default function ProfilesPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <ProfilesFixture />;
}

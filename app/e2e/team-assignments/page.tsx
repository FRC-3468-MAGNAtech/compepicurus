import { notFound } from "next/navigation";
import { TeamAssignmentsFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/team-assignments.e2e.ts, P31): the real TeamAssignmentsView on in-memory teams and scouts, with publish and undo
// applied to that memory. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts).
export const dynamic = "force-dynamic";

export default function TeamAssignmentsPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <TeamAssignmentsFixture />;
}

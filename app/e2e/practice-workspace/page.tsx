import { notFound } from "next/navigation";
import { WorkspaceFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/practice-workspace.e2e.ts, P24): the real ScoutingWorkspace, ScoutForm and (placeholder) video player in the
// same two-robot flow and action bar as the practice screens, with no login and no Firestore. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts sets it for its
// own server), so it does nothing in production.
export const dynamic = "force-dynamic";

export default function PracticeWorkspacePage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <WorkspaceFixture />;
}

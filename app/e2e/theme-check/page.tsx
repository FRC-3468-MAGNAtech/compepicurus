import { notFound } from "next/navigation";
import { ThemeCheckFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/*.e2e.ts, P18): the real Sidebar, Topbar, Appearance panel and page
// transition on a signed-out page, plus one sample of every glass class, so the theme, blur, sidebar-arrow and
// connection-chip tests can run without a Firebase login. It is a 404 unless E2E_THEME_CHECK=1 is set (playwright.config.ts
// sets it for its own server), so it does nothing in production.
export const dynamic = "force-dynamic";

export default function ThemeCheckPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <ThemeCheckFixture />;
}

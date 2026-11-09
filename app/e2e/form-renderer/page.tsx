import { notFound } from "next/navigation";
import { FormRendererFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/form-renderer.e2e.ts, P27): the real FormRenderer with the new field types, per-team boxes, plan comparison and
// photo uploads (a fake uploader), on in-memory data. A 404 unless E2E_THEME_CHECK=1 (playwright.config.ts sets it for its own server).
export const dynamic = "force-dynamic";

export default function FormRendererPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <FormRendererFixture />;
}

import { notFound } from "next/navigation";
import { FormBuilderFixture } from "./fixture";

// A test-only page for the Playwright suite (e2e/form-builder.e2e.ts, P22): the real Admin Panel > Forms tab and Form Builder on an in-memory form
// store, with no Firebase login. A 404 unless E2E_THEME_CHECK=1 is set (playwright.config.ts sets it for its own server), so it does nothing in production.
export const dynamic = "force-dynamic";

export default function FormBuilderPage() {
  if (process.env.E2E_THEME_CHECK !== "1") notFound();
  return <FormBuilderFixture />;
}

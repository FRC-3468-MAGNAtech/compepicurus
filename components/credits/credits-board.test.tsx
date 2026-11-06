import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";
import { CreditsBoard } from "./credits-board";

// FIX3: Credits must show the same content to everyone, an admin included, in
// normal view; an admin only *adds* the inline controls (no edit mode to switch on),
// and a non-admin never gets any. Rendered server-side, which is what the first
// paint of the page is.

const render = (admin: boolean) => renderToString(<CreditsBoard sections={DEFAULT_CREDITS} admin={admin} onOp={() => {}} />);

// The visible text of the markup, so the comparison ignores the extra control markup.
const textOf = (html: string) =>
  html
    .replace(/<button[^>]*aria-label="[^"]*"[^>]*>.*?<\/button>/g, "") // admin icon buttons carry only an aria-label
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("CreditsBoard in normal view", () => {
  it("shows every section title, entry name, and description to a non-admin", () => {
    const html = render(false);
    for (const section of DEFAULT_CREDITS) {
      expect(html).toContain(section.title);
      for (const entry of section.entries) {
        expect(html).toContain(entry.name.replace(/&/g, "&amp;"));
      }
    }
    expect(html).toContain("Claude (Anthropic)");
  });

  it("shows an admin exactly the same content — nothing is hidden behind an edit mode", () => {
    const member = textOf(render(false));
    const admin = textOf(render(true));
    // Everything a member sees, an admin sees (the admin markup only adds controls, plus "Add credit" / "Add section" buttons).
    for (const section of DEFAULT_CREDITS) {
      expect(member).toContain(section.title);
      expect(admin).toContain(section.title);
      for (const entry of section.entries) {
        expect(admin).toContain(entry.name);
        expect(member).toContain(entry.description.replace(/&/g, "&"));
        expect(admin).toContain(entry.description.replace(/&/g, "&"));
      }
    }
  });

  it("gives an admin the Add / Edit / Reorder / Delete controls inline by default, and a non-admin none", () => {
    const member = render(false);
    const admin = render(true);
    for (const label of ["Add section", "Add credit", "Rename", "Delete", "Move", "Edit", "Drag"]) {
      expect(admin, label).toContain(label);
      expect(member, label).not.toContain(label);
    }
    expect(member).not.toMatch(/aria-label="(Edit|Delete|Rename|Move|Drag)/);
  });

  it("has no edit-mode toggle for anyone", () => {
    for (const html of [render(true), render(false)]) expect(html.toLowerCase()).not.toMatch(/edit mode|done editing|enable editing/);
  });
});

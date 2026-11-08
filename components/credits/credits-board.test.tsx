import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";
import { CreditsBoard } from "./credits-board";
import { CreditsEditToggle } from "./credits-edit-toggle";

// FIX4: Credits is a clean normal view for EVERYONE, admins included (identical markup, no controls). An admin
// gets the editing controls only after pressing "Edit credits" (the `editing` switch, which is never the default);
// a non-admin never gets any, even if `editing` were forced on. Rendered server-side, the page's first paint.

const board = (admin: boolean, editing?: boolean) => renderToString(<CreditsBoard sections={DEFAULT_CREDITS} admin={admin} editing={editing} onOp={() => {}} />);
const toggle = (props: Partial<Parameters<typeof CreditsEditToggle>[0]> = {}) =>
  renderToString(<CreditsEditToggle canEdit editing={false} unsavedCount={0} onEdit={() => {}} onDone={() => {}} {...props} />);

const CONTROLS = ["Add section", "Add credit", "Rename", "Delete", "Move", "Edit", "Drag"];

describe("Credits normal view", () => {
  it("shows every section title, entry name and description to a member", () => {
    const html = board(false);
    for (const section of DEFAULT_CREDITS) {
      expect(html).toContain(section.title);
      for (const entry of section.entries) expect(html).toContain(entry.name.replace(/&/g, "&amp;"));
    }
    expect(html).toContain("Claude (Anthropic)");
  });

  it("renders an admin's normal view byte-for-byte the same as a member's (no controls, nothing hidden)", () => {
    // React's generated ids (useId) can differ between renders of different trees, so compare with them removed.
    const strip = (html: string) => html.replace(/ (aria-controls|id|aria-describedby)="[^"]*"/g, "");
    expect(strip(board(true))).toBe(strip(board(false)));
    for (const label of CONTROLS) expect(board(true), label).not.toContain(label);
    expect(board(true)).not.toMatch(/aria-label="(Edit|Delete|Rename|Move|Drag)/);
  });

  it("an admin sees the same content, plus every control, only in edit mode", () => {
    const admin = board(true, true);
    for (const label of CONTROLS) expect(admin, label).toContain(label);
    for (const section of DEFAULT_CREDITS) {
      expect(admin).toContain(section.title);
      for (const entry of section.entries) expect(admin).toContain(entry.name.replace(/&/g, "&amp;"));
    }
  });

  it("a non-admin never gets controls, even if editing is somehow on", () => {
    const html = board(false, true);
    for (const label of CONTROLS) expect(html, label).not.toContain(label);
  });
});

describe("the Edit credits toggle", () => {
  it("a non-admin never sees an Edit button (or Done)", () => {
    const html = toggle({ canEdit: false });
    expect(html).toBe("");
    expect(toggle({ canEdit: false, editing: true })).toBe("");
  });

  it("an admin starts in normal view with an Edit credits button, and sees Done only while editing", () => {
    expect(toggle()).toContain("Edit credits");
    expect(toggle()).not.toContain("Done");
    const editing = toggle({ editing: true });
    expect(editing).toContain("Done");
    expect(editing).not.toContain("Edit credits");
  });
});

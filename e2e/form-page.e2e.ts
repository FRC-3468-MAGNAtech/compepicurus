import { expect, test, type Page } from "@playwright/test";

// P28: the Lead Scout, Match Strategy and Drive Reflection pages (the real FormPageView) and the sticky notes panel, on /e2e/form-page. What each role may open is
// proved by the page-access unit and rules tests; this is the forms themselves in a browser.

async function open(page: Page, query: string) {
  await page.goto(`/e2e/form-page?${query}`);
  await expect(page.getByTestId("form-page")).toBeVisible();
  await page.waitForFunction(() => Array.isArray((window as unknown as { __saved?: unknown[] }).__saved));
  await page.waitForTimeout(300);
}
type Saved = { formType: string; matchKey?: string; alliance?: string; values: Record<string, unknown>; stickyNotes: { text: string; color: string; pinned?: boolean }[]; linkedEntryId?: string; planDifferences?: number };
const saved = (page: Page) => page.evaluate(() => (window as unknown as { __saved: Saved[] }).__saved);
const choose = async (page: Page, match: string, side: "red" | "blue") => {
  await page.getByTestId("match-select").selectOption(match);
  await page.getByTestId(`alliance-${side}`).click();
};

test.describe("Lead Scout", () => {
  test("a 2-team alliance: the alliance box titled RED / teams, two team boxes, no sticky notes panel", async ({ page }) => {
    await open(page, "form=lead");
    await expect(page.getByTestId("notes-panel")).toHaveCount(0); // the Lead Scout has its own notes boxes
    await choose(page, "Q5", "red");
    await expect(page.getByTestId("form-section-alliance").getByTestId("section-title")).toHaveText("RED / 1111, 2222");
    await expect(page.getByTestId("team-box-1")).toContainText("Red 1 · 1111");
    await expect(page.getByTestId("team-box-2")).toContainText("Red 2 · 2222");
    await expect(page.getByTestId("team-box-3")).toHaveCount(0);
    await choose(page, "Q5", "blue");
    await expect(page.getByTestId("form-section-alliance").getByTestId("section-title")).toHaveText("BLUE / 3333, 4444");
  });

  test("a playoff alliance draws three team boxes", async ({ page }) => {
    await open(page, "form=lead");
    await choose(page, "F2", "red");
    await expect(page.getByTestId("form-section-alliance").getByTestId("section-title")).toHaveText("RED / 10, 20, 30");
    await expect(page.locator("[data-testid^='team-box-']")).toHaveCount(3);
  });

  test("notes and a 1-5 skill for the alliance and each team, the team can be corrected, and it saves exactly that", async ({ page }) => {
    await open(page, "form=lead");
    await choose(page, "Q5", "red");
    await page.getByTestId("form-section-alliance").locator("textarea").fill("Fast cycle, good alliance");
    await page.getByTestId("form-section-alliance").locator('input[type="range"]').fill("4");
    await page.getByTestId("team-box-1").locator("textarea").fill("Never missed");
    await page.getByTestId("team-box-1").locator('input[type="range"]').fill("5");
    // the schedule had the wrong team in slot 2: correct it
    await page.getByTestId("team-box-2").getByTestId("team-select").click();
    await page.getByTestId("team-search").fill("4444");
    await page.locator("[data-team='4444']").click();
    await expect(page.getByTestId("team-box-2")).toContainText("Red 2 · 4444");
    await page.getByTestId("submit-form").click();
    await expect(page.getByTestId("submit-success")).toBeVisible();
    const [entry] = await saved(page);
    expect(entry).toMatchObject({ formType: "lead-scout", matchKey: "Q5", alliance: "red" });
    expect(entry.values).toMatchObject({ allianceNotes: "Fast cycle, good alliance", allianceSkill: 4, t1_team: 1111, t1_notes: "Never missed", t1_skill: 5, t2_team: 4444 });
    expect(Object.keys(entry.values).some((k) => k.startsWith("t3_"))).toBe(false); // a 2-team alliance stores 2 teams
    // and the form is ready for the next one
    await expect(page.getByTestId("alliance-red")).toHaveAttribute("aria-checked", "false");
  });

  test("a playoff alliance saves all three teams", async ({ page }) => {
    await open(page, "form=lead");
    await choose(page, "F2", "blue");
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry.values).toMatchObject({ t1_team: 40, t2_team: 50, t3_team: 60 });
  });

  test("submitting with nothing chosen says what's missing and saves nothing; a failed save keeps everything", async ({ page }) => {
    await open(page, "form=lead");
    await page.getByTestId("submit-form").click();
    await expect(page.getByTestId("invalid-note")).toBeVisible();
    await expect(page.getByText("Choose a match.")).toBeVisible();
    await expect(page.getByText("Choose Red or Blue.")).toBeVisible();
    expect(await saved(page)).toEqual([]);

    await open(page, "form=lead&fail=1");
    await choose(page, "Q5", "red");
    await page.getByTestId("form-section-alliance").locator("textarea").fill("keep me");
    await page.getByTestId("submit-form").click();
    await expect(page.getByTestId("save-error")).toContainText("nothing was lost");
    await expect(page.getByTestId("form-section-alliance").locator("textarea")).toHaveValue("keep me");
  });

  test("another match clears the old teams' answers but keeps the alliance notes", async ({ page }) => {
    await open(page, "form=lead");
    await choose(page, "Q5", "red");
    await page.getByTestId("form-section-alliance").locator("textarea").fill("alliance note");
    await page.getByTestId("team-box-1").locator("textarea").fill("team note");
    await page.getByTestId("match-select").selectOption("F2");
    await expect(page.getByTestId("form-section-alliance").locator("textarea")).toHaveValue("alliance note");
    await expect(page.getByTestId("team-box-1").locator("textarea")).toHaveValue("");
    await expect(page.getByTestId("team-box-1")).toContainText("Red 1 · 10");
  });
});

test.describe("Match Strategy", () => {
  test("a role and 'Will score in auto' per team, and the sticky notes panel goes with the entry", async ({ page, isMobile }) => {
    await open(page, "form=strategy");
    await choose(page, "Q5", "red");
    await page.getByTestId("team-box-1").getByRole("combobox").click();
    await page.getByRole("option", { name: "Defense" }).click();
    await page.getByTestId("team-box-2").getByRole("checkbox", { name: "Will score in auto" }).click();
    await expect(page.getByTestId("team-box-2")).toContainText("Will score in auto");
    // notes (the panel is a side panel on a wide screen, a bottom sheet on a phone)
    await page.getByTestId("notes-tab").click(); // the form starts the panel closed
    await page.getByTestId("note-add").click();
    await page.getByRole("textbox", { name: "Note" }).first().fill("Opponent plays defense on teleop");
    await expect(page.getByTestId("notes-badge").first()).toHaveText("1");
    if (isMobile) await page.getByTestId("notes-close").click();
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry).toMatchObject({ formType: "match-strategy", matchKey: "Q5", alliance: "red" });
    expect(entry.values).toMatchObject({ t1_role: "defense", t1_auto: false, t2_auto: true });
    expect(entry.stickyNotes).toHaveLength(1);
    expect(entry.stickyNotes[0].text).toBe("Opponent plays defense on teleop");
  });

  test("the role choices are Hive, Flower, Garden, Gathering and Defense", async ({ page }) => {
    await open(page, "form=strategy");
    await choose(page, "Q5", "red");
    await page.getByTestId("team-box-1").getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "Defense" })).toBeVisible();
    expect(await page.getByRole("listbox").getByRole("option").allTextContents()).toEqual(["Hive", "Flower", "Garden", "Gathering", "Defense"]);
  });
});

test.describe("Drive Reflection", () => {
  test("prefills from the plan, marks every difference, follows a plan edit for untouched answers, and records the link", async ({ page }) => {
    await open(page, "form=reflection");
    await expect(page.getByTestId("plan-summary")).toContainText("No plan was found"); // nothing chosen yet
    await choose(page, "Q5", "red");
    await expect(page.getByTestId("plan-summary")).toHaveText("Matches the plan");
    await expect(page.getByTestId("team-box-1").getByRole("combobox")).toContainText("Hive");
    await expect(page.getByTestId("team-box-1").getByRole("checkbox", { name: "Scored in auto" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("plan-diff")).toHaveCount(0);

    // what actually happened differed twice
    await page.getByTestId("team-box-2").getByRole("combobox").click();
    await page.getByRole("option", { name: "Hive" }).click();
    await page.getByTestId("team-box-1").getByRole("checkbox", { name: "Scored in auto" }).click();
    await expect(page.getByTestId("plan-summary")).toHaveText("2 differences from plan");
    await expect(page.getByTestId("plan-diff")).toHaveCount(2);
    await page.getByTestId("team-box-2").getByTestId("plan-diff").click();
    await expect(page.getByText("Planned: Flower")).toBeVisible();

    // the plan is edited after the reflection was started: team 1's role (untouched) follows, the answers already changed stay
    await page.getByTestId("edit-plan").click();
    await expect(page.getByTestId("team-box-1").getByRole("combobox")).toContainText("Flower");
    await expect(page.getByTestId("team-box-2").getByRole("combobox")).toContainText("Hive");

    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry).toMatchObject({ formType: "drive-reflection", linkedEntryId: "plan-1" });
    expect(entry.planDifferences).toBe(2);
    expect(entry.values).toMatchObject({ t1_role: "flower", t1_auto: false, t2_role: "hive" });
  });

  test("with no plan for the match it says so and starts empty", async ({ page }) => {
    await open(page, "form=reflection&plan=0");
    await choose(page, "Q5", "red");
    await expect(page.getByTestId("plan-summary")).toContainText("No plan was found");
    await expect(page.getByTestId("team-box-1").getByRole("combobox")).not.toContainText("Hive");
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry.values.t1_role).toBe("");
    expect(entry.linkedEntryId ?? null).toBeNull(); // no plan, nothing linked
  });
});

test.describe("sticky notes panel", () => {
  test("add, type, colour, pin to the top, delete with a confirmation, and the count badge", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "the desktop side panel (the phone sheet is covered below)");
    await open(page, "form=strategy");
    const panel = page.getByTestId("notes-panel");
    await expect(panel).toHaveAttribute("data-state", "collapsed"); // the form starts it closed
    await panel.getByTestId("notes-tab").click();
    await expect(panel).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("notes-badge")).toHaveCount(0);

    await panel.getByTestId("note-add").click();
    await page.getByRole("textbox", { name: "Note" }).first().fill("first note");
    await panel.getByTestId("note-add").click();
    await page.getByRole("textbox", { name: "Note" }).first().fill("second note");
    await expect(panel.getByTestId("note-card")).toHaveCount(2);
    await expect(panel.getByTestId("notes-badge")).toHaveText("2");
    // newest first
    await expect(panel.getByTestId("note-card").first().getByRole("textbox", { name: "Note" })).toHaveValue("second note");
    // pin the older one: it jumps to the top
    await panel.getByTestId("note-card").nth(1).getByRole("button", { name: "Pin note to the top" }).click();
    await expect(panel.getByTestId("note-card").first().getByRole("textbox", { name: "Note" })).toHaveValue("first note");
    await expect(panel.getByTestId("note-card").first()).toHaveAttribute("data-pinned", "true");
    // a colour
    await panel.getByTestId("note-card").first().getByRole("radio", { name: "Blue" }).click();
    await expect(panel.getByTestId("note-card").first().getByRole("radio", { name: "Blue" })).toHaveAttribute("aria-checked", "true");
    // delete needs a second tap when the note has text
    await panel.getByTestId("note-card").nth(1).getByTestId("note-delete").click();
    await expect(panel.getByTestId("note-card")).toHaveCount(2);
    await panel.getByTestId("note-delete-confirm").click();
    await expect(panel.getByTestId("note-card")).toHaveCount(1);
    await expect(panel.getByTestId("notes-badge")).toHaveText("1");

    // saved into the entry with its colour and pin
    await choose(page, "Q5", "red");
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry.stickyNotes).toEqual([expect.objectContaining({ text: "first note", color: "blue", pinned: true })]);
    // the notes are cleared for the next entry
    await expect(panel.getByTestId("note-card")).toHaveCount(0);
  });

  test("collapses to a tab, and resizes by keyboard within its limits", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop panel");
    await open(page, "form=strategy");
    await page.getByTestId("notes-tab").click();
    const handle = page.getByTestId("notes-resize");
    const before = Number(await handle.getAttribute("aria-valuenow"));
    await handle.focus();
    await page.keyboard.press("ArrowLeft"); // wider
    expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(before + 16);
    await page.keyboard.press("End"); // narrowest
    expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(240);
    await page.keyboard.press("Home"); // widest
    expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(520);
    await handle.dblclick();
    expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(320);
    // the width is remembered
    await page.reload();
    await page.getByTestId("notes-tab").click();
    expect(Number(await page.getByTestId("notes-resize").getAttribute("aria-valuenow"))).toBe(320);
    await page.getByRole("button", { name: "Collapse sticky notes" }).click();
    await expect(page.getByTestId("notes-panel")).toHaveAttribute("data-state", "collapsed");
  });

  test("on a phone: an edge tab opens an expandable, collapsible bottom sheet that doesn't block the form", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone only");
    await open(page, "form=strategy");
    const panel = page.getByTestId("notes-panel");
    await expect(panel).toHaveAttribute("data-state", "collapsed");
    await page.getByTestId("notes-tab").click();
    await expect(panel).toHaveAttribute("data-state", "open");
    const small = (await panel.boundingBox())!.height;
    await page.getByTestId("notes-expand").click();
    await expect(panel).toHaveAttribute("data-state", "expanded");
    expect((await panel.boundingBox())!.height).toBeGreaterThan(small);
    await page.getByTestId("notes-expand").click();
    await expect(panel).toHaveAttribute("data-state", "open");
    // non-modal: the form above the sheet still works while it is open
    await page.getByTestId("alliance-red").scrollIntoViewIfNeeded();
    await page.getByTestId("alliance-red").click({ position: { x: 20, y: 10 } });
    await expect(page.getByTestId("alliance-red")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("notes-close").click();
    await expect(panel).toHaveAttribute("data-state", "collapsed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});

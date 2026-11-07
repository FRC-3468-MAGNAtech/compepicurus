import { expect, test, type Page } from "@playwright/test";

// P22: the Form Builder in a real browser. The fixture page (/e2e/form-builder) is the real Admin Panel > Forms tab on an in-memory form store with no
// Firebase login, and 12 existing BIOBUZZ entries (so a change that affects data shows the "affects N entries" confirmation).

async function openForms(page: Page) {
  await page.goto("/e2e/form-builder");
  await expect(page.getByTestId("forms-panel")).toBeVisible();
  // hydrated (clicks before hydration are silently ignored): the fixture sets window.__audit in an effect
  await page.waitForFunction(() => Array.isArray(window.__audit));
}

const audit = (page: Page) => page.evaluate(() => window.__audit ?? []);
const rows = (page: Page) => page.locator("[data-field-row]");
const saveState = (page: Page) => page.getByTestId("save-state");

async function editBiobuzz(page: Page) {
  await page.getByRole("button", { name: "Edit BIOBUZZ" }).click();
  await expect(page.getByTestId("form-builder")).toBeVisible();
}

async function newFromScratch(page: Page, name: string) {
  await page.getByTestId("new-form").click();
  await page.getByRole("radio", { name: /Start from scratch/ }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByTestId("form-builder")).toBeVisible();
  await expect(page.getByTestId("builder-title")).toHaveText(name);
}

test.describe("Forms list", () => {
  test("lists the built-in BIOBUZZ with its actions, and is the active form for the season", async ({ page }) => {
    await openForms(page);
    const card = page.locator('[data-form-card="biobuzz"]');
    await expect(card).toContainText("BIOBUZZ");
    await expect(card).toContainText("Built-in");
    await expect(card).toContainText("12"); // entries
    await expect(card).toContainText("Active for");
    for (const name of ["Edit BIOBUZZ", "Duplicate BIOBUZZ", "Export BIOBUZZ as JSON", "Set BIOBUZZ as active"]) await expect(card.getByRole("button", { name })).toBeVisible();
    // nothing to reset or compare until it has been edited
    await expect(card.getByRole("button", { name: /Reset BIOBUZZ/ })).toHaveCount(0);
    // it is active for BIOBUZZ's season, so it can't be archived
    await expect(card.getByRole("button", { name: "Archive BIOBUZZ" })).toBeDisabled();
  });

  test("the New form dialog offers the four starts, the template library among them", async ({ page }) => {
    await openForms(page);
    await page.getByTestId("new-form").click();
    for (const name of [/Start from scratch/, /From template/, /Duplicate a form/, /Import JSON/]) await expect(page.getByRole("radio", { name })).toBeVisible();
    await expect(page.getByRole("radio", { name: /From template/ })).toBeEnabled();
  });

  test("duplicates a form into a new custom draft and opens it", async ({ page }) => {
    await openForms(page);
    await page.getByRole("button", { name: "Duplicate BIOBUZZ" }).click();
    await expect(page.getByTestId("builder-title")).toHaveText("BIOBUZZ (copy)");
    await expect(page.getByText("Never published")).toBeVisible();
    await page.getByRole("button", { name: "Back to forms" }).click();
    await expect(page.locator('[data-form-card="biobuzz-copy"]')).toContainText("Custom");
    await expect(page.locator('[data-form-card="biobuzz-copy"]')).toContainText("Draft");
    expect((await audit(page)).map((a) => a.action)).toContain("create-form");
  });

  test("imports a form from JSON, and refuses garbage with a readable error", async ({ page }) => {
    await openForms(page);
    await page.getByTestId("new-form").click();
    await page.getByRole("radio", { name: /Import JSON/ }).click();
    await page.getByLabel("Form JSON").fill("{not json");
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByTestId("import-preview")).toContainText("isn't valid JSON");
    await page.getByRole("button", { name: "Choose another file" }).click();
    await page.getByLabel("Form JSON").fill(JSON.stringify({ format: "other" }));
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByTestId("import-preview")).toContainText("isn't a CompEpicurus form export");
  });
});

test.describe("builder (desktop)", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!!isMobile, "the full builder is desktop-first; phones are covered below");
  });

  test("editing BIOBUZZ shows the copy-on-write notice, then add / rename / autosave / undo / redo", async ({ page }) => {
    await openForms(page);
    await editBiobuzz(page);
    await expect(page.getByTestId("copy-on-write-notice")).toContainText("your team's own copy");
    await expect(saveState(page)).toHaveAttribute("data-state", "saved");
    const before = await rows(page).count();

    await page.getByRole("button", { name: "Add Counter" }).click();
    await expect(rows(page)).toHaveCount(before + 1);
    await expect(page.getByTestId("field-inspector")).toBeVisible();
    await expect(saveState(page)).toHaveAttribute("data-state", "unsaved");

    // the key follows the label until it's edited by hand
    await page.getByLabel("Label", { exact: true }).fill("Samples collected");
    await expect(page.getByLabel("Data key")).toHaveValue("samplesCollected");
    await expect(page.locator('[data-field-row="samplesCollected"]')).toBeVisible();
    await expect(saveState(page)).toHaveAttribute("data-state", "saved", { timeout: 10_000 });

    // undo steps back through the label edit, then the add; redo walks forward again
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Label", { exact: true })).toHaveValue("New counter");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(rows(page)).toHaveCount(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await page.keyboard.press("Control+y");
    await page.keyboard.press("Control+y");
    await expect(rows(page)).toHaveCount(before + 1);
    await expect(page.locator('[data-field-row="samplesCollected"]')).toBeVisible();
  });

  test("a new form starts with the five categories and the locked system fields", async ({ page }) => {
    await openForms(page);
    await newFromScratch(page, "Pit scouting");
    for (const title of ["Pre-Match", "Autonomous", "Teleoperated", "Endgame", "Misc"]) await expect(page.getByRole("region", { name: `Category ${title}` })).toBeVisible();
    for (const name of ["Assigned match", "Scout name", "Team number"]) {
      await expect(page.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Duplicate ${name}` })).toHaveCount(0);
    }
    await expect(page.locator('[data-field-row="comments"]')).toBeVisible();
    // scoring is on with nothing scoring: one blocking problem, until scoring is turned off
    await page.getByRole("tab", { name: /Problems/ }).click();
    await expect(page.getByTestId("validation-panel")).toContainText("no field scores any points");
    await page.getByRole("button", { name: "Form settings" }).click();
    await page.getByRole("switch", { name: "This form scores" }).click();
    await page.getByRole("tab", { name: /Problems/ }).click();
    await expect(page.getByTestId("validation-clean")).toBeVisible();
  });

  test("the inspector edits points, options and conditions, and the panels follow", async ({ page }) => {
    await openForms(page);
    await newFromScratch(page, "Practice robot");
    await page.getByRole("button", { name: "Add Counter" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Samples");
    // scoring: points per tally
    await page.getByRole("button", { name: /^Scoring/ }).click();
    await page.getByLabel("Points", { exact: true }).click();
    await page.getByRole("option", { name: "Points per tally" }).click();
    await page.getByRole("spinbutton", { name: "Points per tally" }).fill("4");
    await expect(page.locator('[data-field-row="samples"]')).toContainText("4 pts each");

    // the scoring panel's scenario calculator uses the real scoring function
    await page.getByRole("tab", { name: "Scoring" }).click();
    await expect(page.getByTestId("scoring-summary")).toContainText("Samples");
    await page.getByRole("spinbutton", { name: "Samples" }).fill("3");
    await expect(page.getByTestId("scenario-total")).toContainText("12");
    await expect(page.getByTestId("score-max")).toContainText("no limit");

    // a counter with a maximum has a fixed top score
    await page.getByRole("tab", { name: "Inspector" }).click();
    await page.getByRole("button", { name: "Add Toggle" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Parked");
    await page.getByRole("button", { name: /^Visibility/ }).click();
    await page.getByLabel("Show this field", { exact: true }).click();
    await page.getByRole("option", { name: "Only when another field…" }).click();
    await expect(page.getByLabel("…this field", { exact: true })).toBeVisible();
    await expect(page.locator('[data-field-row="parked"]')).toContainText("if…");

    // analytics preview: the three-tier header, the CSV header row and the team stats, from the form itself
    await page.getByRole("tab", { name: "Analytics" }).click();
    const csv = page.getByTestId("csv-header");
    await expect(csv).toContainText("Information - Information - Match");
    await expect(csv).toContainText("Autonomous - Autonomous - Samples");
    await expect(page.getByTestId("analytics-preview")).toContainText("Team stats");
  });

  test("the live preview is the real scout form: a test fill that scores and never saves", async ({ page }) => {
    await openForms(page);
    await editBiobuzz(page);
    await page.getByRole("tab", { name: "Preview" }).click();
    const preview = page.getByTestId("live-preview");
    await expect(preview).toContainText("Nothing you enter here is saved");
    await expect(preview.getByRole("switch", { name: /Leave/i }).first()).toBeVisible();
    await expect(page.getByTestId("preview-score")).toContainText("0");
    await preview.getByRole("switch", { name: /Leave/i }).first().click();
    await expect(page.getByTestId("preview-score")).not.toContainText(/Test score\s*0\b/);
    await preview.getByRole("button", { name: "Check required fields" }).click();
    await expect(preview.getByRole("status")).toBeVisible();
    // switching the frame, and clearing the fill
    await preview.getByRole("button", { name: "Tablet" }).click();
    await expect(page.getByTestId("preview-frame-tablet")).toBeVisible();
    await preview.getByRole("button", { name: "Clear" }).click();
    expect((await audit(page)).length).toBe(0); // nothing was written
  });

  test("publish shows what changes, asks for confirmation when entries are affected, then versions, history, restore and audit all work", async ({ page }) => {
    await openForms(page);
    await editBiobuzz(page);
    await page.getByRole("button", { name: "Add Counter" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Samples collected");
    await page.getByTestId("publish-button").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("as version 2");
    await expect(dialog).toContainText("from the built-in");
    await expect(dialog).toContainText("Samples collected");
    await expect(dialog).toContainText("affects data");
    await expect(page.getByTestId("publish-affected")).toContainText("12 existing entries");
    const publish = dialog.getByRole("button", { name: "Publish version 2" });
    await expect(publish).toBeDisabled(); // needs the explicit tick
    await dialog.getByRole("checkbox").check();
    await dialog.getByLabel("What changed (optional note)").fill("Count samples");
    await publish.click();
    await expect(page.getByRole("status").filter({ hasText: "Published version 2" })).toBeVisible();
    await expect(page.getByText("v2 live")).toBeVisible();

    let entries = await audit(page);
    const published = entries.find((a) => a.action === "publish-form")!;
    expect(published.target).toMatchObject({ formId: "biobuzz", note: "Count samples" });
    expect(published.after).toMatchObject({ version: 2, affectsData: true, affectedEntries: 12 });

    // history: both versions, the built-in original at the bottom; restoring puts the old one in the draft
    await page.getByRole("button", { name: "Version history" }).click();
    const history = page.getByRole("dialog");
    await expect(history).toContainText("Version 2");
    await expect(history).toContainText("built-in original");
    await expect(history).toContainText("Count samples");
    await expect(history.getByTestId("diff-view")).toContainText("Samples collected");
    await history.getByRole("button", { name: /Version 1/ }).click();
    await history.getByRole("button", { name: "vs. my draft" }).click();
    await history.getByRole("button", { name: "Restore this version" }).click();
    await history.getByRole("button", { name: "Restore into draft" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Version 1 is in your draft" })).toBeVisible();
    await expect(page.locator('[data-field-row="samplesCollected"]')).toHaveCount(0);
    entries = await audit(page);
    expect(entries.map((a) => a.action)).toEqual(expect.arrayContaining(["publish-form", "restore-form-version"]));

    // back at the list: it is an edited built-in at v2 with unpublished changes, which can be compared, reset or exported
    await page.getByRole("button", { name: "Back to forms" }).click();
    const card = page.locator('[data-form-card="biobuzz"]');
    await expect(card).toContainText("Built-in (edited)");
    await expect(card).toContainText("Published v2");
    await expect(card).toContainText("Unpublished changes");
    await card.getByRole("button", { name: /View changes in BIOBUZZ from the built-in/ }).click();
    await expect(page.getByRole("dialog")).toContainText("identical to the built-in", { ignoreCase: true });
    await page.keyboard.press("Escape");
    await card.getByRole("button", { name: "Reset BIOBUZZ to the built-in" }).click();
    await page.getByRole("button", { name: "Reset to built-in" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Reset to the built-in" })).toBeVisible();
    await expect(card).toContainText("Built-in");
    await expect(card.getByRole("button", { name: /Reset BIOBUZZ/ })).toHaveCount(0);
    expect((await audit(page)).map((a) => a.action)).toContain("reset-form-to-builtin");
  });

  test("publishing is refused while there are blocking problems, and the draft says why it isn't saved", async ({ page }) => {
    await openForms(page);
    await newFromScratch(page, "Broken one");
    await page.getByRole("button", { name: "Form settings" }).click();
    await page.getByRole("switch", { name: "This form scores" }).click(); // scoring off so the only error is ours
    await page.getByRole("button", { name: "Add Toggle" }).click();
    await page.getByLabel("Label", { exact: true }).fill("");
    await expect(saveState(page)).toHaveAttribute("data-state", "invalid");
    await page.getByTestId("publish-button").click();
    await expect(page.getByTestId("publish-blocked")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: /Publish version/ })).toBeDisabled();
  });

  test("a new form can be published and set as the season's active form, and is logged", async ({ page }) => {
    await openForms(page);
    await newFromScratch(page, "Pit scouting");
    await page.getByRole("button", { name: "Form settings" }).click();
    await page.getByRole("switch", { name: "This form scores" }).click();
    await page.getByRole("button", { name: "Add Number" }).click();
    await page.getByTestId("publish-button").click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish version 1" }).click();
    await expect(page.getByText("v1 live")).toBeVisible();
    await page.getByRole("button", { name: "Back to forms" }).click();
    const card = page.locator('[data-form-card="pit-scouting"]');
    await expect(card).toContainText("Published v1");
    await card.getByRole("button", { name: "Set Pit scouting as active" }).click();
    await page.getByRole("button", { name: /Use for BIOBUZZ/ }).click();
    await expect(card).toContainText("Active for");
    await expect(card).toContainText("BIOBUZZ");
    // BIOBUZZ is no longer active for the season, so it can be archived now
    await expect(page.locator('[data-form-card="biobuzz"]').getByRole("button", { name: "Archive BIOBUZZ" })).toBeEnabled();
    const actions = (await audit(page)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["create-form", "publish-form", "set-active-form"]));
  });

  test("Insert from BIOBUZZ clones a category with its points", async ({ page }) => {
    await openForms(page);
    await newFromScratch(page, "Mini game");
    await page.getByRole("button", { name: /^Autonomous\d* fields?|^Autonomous/ }).first().click();
    await page.getByRole("button", { name: "Insert category Autonomous" }).click();
    const copy = page.getByRole("region", { name: /Category Autonomous/ }).last();
    await expect(copy.locator('[data-field-row="autoLeave"]')).toContainText("pts");
  });

  test("fields move with buttons and keyboard shortcuts, not only by dragging", async ({ page }) => {
    await openForms(page);
    await newFromScratch(page, "Order");
    await page.getByRole("button", { name: "Add Toggle" }).click();
    await page.getByLabel("Label", { exact: true }).fill("First");
    await page.getByRole("button", { name: "Add Toggle" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Second");
    const teleop = page.getByRole("region", { name: "Category Autonomous" });
    await expect(teleop.locator("[data-field-row]")).toHaveText([/First/, /Second/]);
    await teleop.getByRole("button", { name: "Move Second up" }).click();
    await expect(teleop.locator("[data-field-row]")).toHaveText([/Second/, /First/]);
    // keyboard: the selected field duplicates with Ctrl+D and deletes with Delete (focus is not in a text box)
    await teleop.getByRole("button", { name: /^Second/ }).first().click();
    await page.keyboard.press("Control+d");
    await expect(teleop.locator("[data-field-row]")).toHaveCount(3);
    await page.keyboard.press("Delete");
    await expect(teleop.locator("[data-field-row]")).toHaveCount(2);
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog")).toContainText("Keyboard shortcuts");
  });
});

test.describe("builder (phone)", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, "phone layout");
  });

  test("shows the forms list, the read-only structure, simple field edits and the preview, with a note about a larger screen", async ({ page }) => {
    await openForms(page);
    await expect(page.locator('[data-form-card="biobuzz"]')).toBeVisible();
    await editBiobuzz(page);
    await expect(page.getByTestId("compact-note")).toContainText("works best on a larger screen");
    // no palette, no structural controls
    await expect(page.getByRole("complementary", { name: "Palette" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Drag / })).toHaveCount(0);
    // a simple edit: select a field, change its label
    await page.locator("[data-field-row]").nth(3).getByRole("button").first().click();
    await page.getByRole("button", { name: "Edit & preview" }).click();
    await expect(page.getByTestId("field-inspector")).toBeVisible();
    await page.getByLabel("Label", { exact: true }).fill("Renamed on a phone");
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByTestId("live-preview")).toBeVisible();
    // no horizontal page scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
});

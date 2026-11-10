import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// P23: form templates in a real browser, on the fixture page (/e2e/form-builder): the real Forms tab, template library and Template Review panel on
// in-memory stores, no Firebase login. The viewer is the owner of account "t1" ("Ada's team"); with ?role=platform they are also the platform owner.

async function open(page: Page, platform = false) {
  await page.goto(`/e2e/form-builder${platform ? "?role=platform" : ""}`);
  await expect(page.getByTestId("forms-panel")).toBeVisible();
  await page.waitForFunction(() => Array.isArray(window.__audit));
}
const audit = (page: Page) => page.evaluate(() => window.__audit ?? []);
const library = (page: Page) => page.getByTestId("template-library");
/** A card in the library (the review panel, when shown, has cards of its own). */
const card = (page: Page, id: string) => library(page).locator(`[data-template-card="${id}"]`);

async function openLibrary(page: Page, tab: "public" | "mine" = "public") {
  await page.getByTestId("view-templates").click();
  await expect(library(page)).toBeVisible();
  if (tab === "mine") await page.getByRole("tab", { name: /My templates/ }).click();
}

const ids = (page: Page) => library(page).locator("[data-template-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-template-card")));
// P28 added three official templates (Lead Scout, Match Strategy, Drive Reflection); the older orderings are checked without them
const NEW_OFFICIAL = ["official-lead-scout", "official-match-strategy", "official-drive-reflection", "official-pit-scout", "official-team-strategy", "official-helper"];
const olderIds = async (page: Page) => (await ids(page)).filter((id) => !NEW_OFFICIAL.includes(id ?? ""));

test.describe("template library", () => {
  test("lists public templates with their facts and an Official badge, and never anyone's private ones", async ({ page }) => {
    await open(page);
    await openLibrary(page);
    expect(new Set(await ids(page))).toEqual(new Set(["official-biobuzz", "official-blank", ...NEW_OFFICIAL, "pub-pit", "pub-drive", "pub-reported", "mine-public"]));
    const official = card(page, "official-biobuzz");
    await expect(official).toContainText("BIOBUZZ Match Scout");
    await expect(official).toContainText("Official");
    await expect(official).toContainText("CompEpicurus");
    await expect(official).toContainText("v1");
    await expect(official).toContainText("7 uses");
    await expect(official).toContainText(/\d+ categories, \d+ fields/);
    await expect(official).toContainText("biobuzz");
    // not the ones that are private, rejected or waiting
    for (const id of ["mine-private", "mine-rejected", "wait-1"]) await expect(card(page, id)).toHaveCount(0);
    await expect(card(page, "official-blank")).toContainText("Blank (standard phases)");
  });

  test("searches, filters by tag, and sorts newest and most used", async ({ page }) => {
    await open(page);
    await openLibrary(page);
    // newest first by default
    expect(await olderIds(page)).toEqual(["pub-pit", "pub-drive", "official-biobuzz", "official-blank", "pub-reported", "mine-public"]);
    await page.getByLabel("Sort by").click();
    await page.getByRole("option", { name: "Most used" }).click();
    expect(await olderIds(page)).toEqual(["pub-pit", "official-biobuzz", "official-blank", "pub-drive", "mine-public", "pub-reported"]);
    await page.getByLabel("Sort by").click();
    await page.getByRole("option", { name: "Newest" }).click();
    expect((await ids(page))[0]).toBe("pub-pit");

    await page.getByLabel("Search templates").fill("inspection");
    expect(await ids(page)).toEqual(["pub-pit"]);
    await page.getByLabel("Search templates").fill("team 4242");
    expect(await ids(page)).toEqual(["pub-drive"]);
    await page.getByLabel("Search templates").fill("zzzz nothing");
    await expect(page.getByTestId("templates-empty")).toContainText("Nothing matches that search");
    await page.getByLabel("Search templates").fill("");

    await page.getByRole("button", { name: /^drive/ }).click();
    expect(await ids(page)).toEqual(["pub-drive"]);
    await page.getByRole("button", { name: /^drive/ }).click();
    expect((await ids(page)).length).toBe(6 + NEW_OFFICIAL.length);
  });

  test("previews the real form with a test fill that never saves", async ({ page }) => {
    await open(page);
    await openLibrary(page);
    await page.getByRole("button", { name: "Preview BIOBUZZ Match Scout" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Nothing you enter is saved");
    const preview = dialog.getByTestId("live-preview");
    await expect(preview.getByRole("switch", { name: /Leave/i }).first()).toBeVisible();
    await expect(page.getByTestId("preview-score")).toContainText("0");
    await preview.getByRole("switch", { name: /Leave/i }).first().click();
    await expect(page.getByTestId("preview-score")).not.toContainText(/Test score\s*0\b/);
    expect(await audit(page)).toEqual([]);
  });

  test("uses a template: a new draft form that remembers its source, and the use is counted", async ({ page }) => {
    await open(page);
    await openLibrary(page);
    await page.getByRole("button", { name: "Use template Pit scouting" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Makes a draft form in your account");
    await dialog.getByLabel("Name of your form").fill("Our pit check");
    await dialog.getByRole("button", { name: "Create draft form" }).click();
    await expect(page.getByTestId("builder-title")).toHaveText("Our pit check");
    await expect(page.getByText("Never published")).toBeVisible();
    const actions = (await audit(page)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["use-form-template", "create-form"]));
    await page.getByRole("button", { name: "Back to forms" }).click();
    await expect(page.locator('[data-form-card="our-pit-check"]')).toContainText("From template");
    await openLibrary(page);
    await expect(card(page, "pub-pit")).toContainText("13 uses");
    // the same account using it again isn't counted twice
    await page.getByRole("button", { name: "Use template Pit scouting" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create draft form" }).click();
    await expect(page.getByTestId("builder-title")).toBeVisible();
    await page.getByRole("button", { name: "Back to forms" }).click();
    await openLibrary(page);
    await expect(card(page, "pub-pit")).toContainText("13 uses");
  });

  test("exports a template as JSON with the schema version and a checksum", async ({ page }) => {
    await open(page);
    await openLibrary(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Pit scouting as JSON" }).click()]);
    expect(download.suggestedFilename()).toBe("pit-scouting.form.json");
    const json = JSON.parse(readFileSync((await download.path())!, "utf8"));
    expect(json).toMatchObject({ format: "compepicurus-form", formatVersion: 1 });
    expect(json.checksum).toMatch(/^[0-9a-f]{16}$/);
    expect(json.form.name).toBe("Pit scouting");
  });

  test("the New form dialog's From template opens the library", async ({ page }) => {
    await open(page);
    await page.getByTestId("new-form").click();
    await expect(page.getByRole("radio", { name: /From template/ })).toBeEnabled();
    await page.getByRole("radio", { name: /From template/ }).click();
    await expect(library(page)).toBeVisible();
  });
});

test.describe("my templates", () => {
  test("shows where each is in the process, with the rejection reason", async ({ page }) => {
    await open(page);
    await openLibrary(page, "mine");
    expect(new Set(await ids(page))).toEqual(new Set(["mine-private", "mine-rejected", "mine-public"]));
    await expect(card(page, "mine-private")).toContainText("Private");
    await expect(card(page, "mine-rejected")).toContainText("Not approved");
    await expect(card(page, "mine-rejected")).toContainText("Too generic: add something specific");
    await expect(card(page, "mine-public")).toContainText("Public");
    // private ones are never in the public list
    await page.getByRole("tab", { name: /Public templates/ }).click();
    await expect(card(page, "mine-private")).toHaveCount(0);
    await expect(card(page, "mine-public")).toBeVisible();
  });

  test("saves a form as a private template, edits its details, updates it from a form (a new version) and deletes it", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Save BIOBUZZ as a template" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name")).toHaveValue("BIOBUZZ");
    await dialog.getByLabel("Name").fill("Our BIOBUZZ");
    await dialog.getByLabel("Tags").fill("biobuzz, <b>2026</b>");
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(library(page)).toBeVisible(); // switched to My templates
    const saved = library(page).locator("[data-template-card]", { hasText: "Our BIOBUZZ" });
    await expect(saved).toContainText("Private");
    await expect(saved).toContainText("v1");
    await expect(saved).toContainText("2026"); // the <b> tags were stripped
    expect((await audit(page)).map((a) => a.action)).toContain("save-form-template");

    await saved.getByRole("button", { name: /Edit details/ }).click();
    await page.getByRole("dialog").getByLabel("Description").fill("Our scouting form");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(saved).toContainText("Our scouting form");
    await expect(saved).toContainText("v1"); // details only: no new version

    await saved.getByRole("button", { name: /Update from a form/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Save as version 2/ }).click();
    await expect(saved).toContainText("v1"); // the same form: no change, still version 1
    // a different form makes version 2
    await saved.getByRole("button", { name: /Delete/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(library(page).locator("[data-template-card]", { hasText: "Our BIOBUZZ" })).toHaveCount(0);
    expect((await audit(page)).map((a) => a.action)).toContain("delete-form-template");
  });

  test("updating a private template from a different form makes a new version; the same form doesn't", async ({ page }) => {
    await open(page);
    await openLibrary(page, "mine");
    await expect(card(page, "mine-private")).toContainText("v1");
    await card(page, "mine-private").getByRole("button", { name: /Update from a form/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Creates a new version of this private template");
    await page.getByRole("dialog").getByRole("button", { name: "Save as version 2" }).click(); // the first form listed is BIOBUZZ: different content
    await expect(card(page, "mine-private")).toContainText("v2");
    await expect(card(page, "mine-private")).toContainText("Our pit form"); // the name is kept
    await card(page, "mine-private").getByRole("button", { name: /Update from a form/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save as version 3" }).click(); // the same form again: nothing new
    await expect(card(page, "mine-private")).toContainText("v2");
    expect((await audit(page)).filter((x) => x.action === "update-form-template")).toHaveLength(2);
  });

  test("asks to publish (it then waits, and can be withdrawn), and a rejected one can be asked again", async ({ page }) => {
    await open(page);
    await openLibrary(page, "mine");
    await card(page, "mine-private").getByRole("button", { name: /Request to publish/ }).click();
    await expect(page.getByRole("dialog")).toContainText("The platform owner reviews every public template");
    await page.getByRole("dialog").getByRole("button", { name: "Send for review" }).click();
    await expect(card(page, "mine-private")).toContainText("Waiting for review");
    await expect(card(page, "mine-private").getByRole("button", { name: /Edit details/ })).toHaveCount(0); // locked while waiting
    await card(page, "mine-private").getByRole("button", { name: /Withdraw/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unpublish" }).click();
    await expect(card(page, "mine-private")).toContainText("Private");
    await card(page, "mine-rejected").getByRole("button", { name: /Request to publish/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send for review" }).click();
    await expect(card(page, "mine-rejected")).toContainText("Waiting for review");
    expect((await audit(page)).map((a) => a.action)).toEqual(expect.arrayContaining(["request-template-publish", "unpublish-template"]));
  });

  test("an author can unpublish their public template, and report only other people's", async ({ page }) => {
    await open(page);
    await openLibrary(page);
    await expect(card(page, "mine-public").getByRole("button", { name: /Report/ })).toHaveCount(0);
    await card(page, "pub-pit").getByRole("button", { name: "Report Pit scouting" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Send report" })).toBeDisabled();
    await dialog.getByLabel("What's the problem?").fill("A link that goes somewhere bad");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Thanks" })).toBeVisible();
    await card(page, "pub-pit").getByRole("button", { name: "Report Pit scouting" }).click();
    await page.getByRole("dialog").getByLabel("What's the problem?").fill("Again");
    await page.getByRole("dialog").getByRole("button", { name: "Send report" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "already reported" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: /My templates/ }).click();
    await card(page, "mine-public").getByRole("button", { name: "Unpublish" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unpublish" }).click();
    await expect(card(page, "mine-public")).toContainText("Private");
  });
});

test.describe("template review (platform owner)", () => {
  test("is hidden from everyone else", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("template-review")).toHaveCount(0);
  });

  test("approves and rejects (with a reason), handles reports and take-downs, and seeds the official templates", async ({ page }) => {
    await open(page, true);
    const review = page.getByTestId("template-review");
    await expect(review).toBeVisible();
    await expect(review.getByRole("region", { name: "Waiting for review", exact: true })).toContainText("Awaiting review");

    // the author's own request joins the queue
    await openLibrary(page, "mine");
    await card(page, "mine-private").getByRole("button", { name: /Request to publish/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send for review" }).click();
    const waiting = review.getByRole("region", { name: "Waiting for review", exact: true });
    await expect(waiting).toContainText("Our pit form");

    // reject needs a reason, and sends it back to the author with it
    await waiting.getByRole("button", { name: "Reject Our pit form" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reject", exact: true })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Please add a description of the scoring");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Rejected “Our pit form”" })).toBeVisible();
    await expect(card(page, "mine-private")).toContainText("Not approved");
    await expect(card(page, "mine-private")).toContainText("Please add a description of the scoring");

    // approve the other one: it becomes public
    await waiting.getByRole("button", { name: "Approve Awaiting review" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved “Awaiting review”" })).toBeVisible();
    await page.getByRole("tab", { name: /Public templates/ }).click();
    await expect(card(page, "wait-1")).toContainText("Awaiting review");

    // a reported template: see the reports, dismiss them, or take it down with a reason
    const reported = review.getByRole("region", { name: "Reported" });
    await expect(reported).toContainText("Suspicious form");
    await reported.getByRole("button", { name: "Take down Suspicious form" }).click();
    await page.getByRole("dialog").getByLabel("Reason").fill("It links to a site we don't allow");
    await page.getByRole("dialog").getByRole("button", { name: "Take down" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Took down “Suspicious form”" })).toBeVisible();
    await expect(library(page).locator('[data-template-card="pub-reported"]')).toHaveCount(0);

    // mark one official / remove the badge
    const publicList = review.getByRole("region", { name: "Public templates" });
    await publicList.getByRole("button", { name: "Mark official: Driver feedback" }).click();
    await expect(page.getByRole("status").filter({ hasText: "is now official" })).toBeVisible();
    await expect(card(page, "pub-drive")).toContainText("Official");

    // seeding the official templates when they exist and haven't changed
    await review.getByRole("button", { name: "Seed official templates" }).click();
    await expect(page.getByRole("status").filter({ hasText: "biobuzz unchanged" })).toBeVisible();

    const actions = (await audit(page)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["reject-template", "approve-template", "takedown-template", "seed-official-templates"]));
  });

  test("an update to a public template waits for review while the old version stays live, then 'Update available' reaches forms made from it, with a diff", async ({ page }) => {
    await open(page, true);
    // a form made from the public template (version 1)
    await openLibrary(page);
    await card(page, "mine-public").getByRole("button", { name: "Use template Our public form" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create draft form" }).click();
    await expect(page.getByTestId("builder-title")).toHaveText("Our public form");
    await page.getByRole("button", { name: "Back to forms" }).click();
    await expect(page.locator('[data-form-card="our-public-form"]')).toContainText("From template");
    await expect(page.locator('[data-form-card="our-public-form"]')).not.toContainText("Update available");

    // send a new version (from BIOBUZZ, so it differs): it waits, version 1 stays live
    await openLibrary(page, "mine");
    await card(page, "mine-public").getByRole("button", { name: "Send an update to Our public form" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send for review" }).click();
    await expect(card(page, "mine-public")).toContainText("Update waiting for review");
    await expect(card(page, "mine-public")).toContainText("v1");

    // the platform owner sees what it changes and approves it
    const updates = page.getByRole("region", { name: "Updates waiting for review" });
    await expect(updates).toContainText("Our public form");
    await updates.getByRole("button", { name: "Review the update to Our public form" }).click();
    await expect(page.getByRole("dialog").getByTestId("diff-view")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Approve update" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved the update" })).toBeVisible();
    await expect(card(page, "mine-public")).toContainText("v2");

    // the form made from version 1 is offered the update, never changed by it
    await page.getByTestId("view-forms").click();
    const formCard = page.locator('[data-form-card="our-public-form"]');
    await expect(formCard).toContainText("Update available");
    await formCard.getByRole("button", { name: "Review the template update for Our public form" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("now at version 2");
    await expect(dialog.getByTestId("diff-view")).toBeVisible();
    await dialog.getByRole("button", { name: "Create a draft from version 2" }).click();
    await expect(page.getByTestId("builder-title")).toHaveText("Our public form (v2)");
    await page.getByRole("button", { name: "Back to forms" }).click();
    await expect(page.locator('[data-form-card="our-public-form"]')).toContainText("Update available"); // the original is untouched, still on version 1
    await expect(page.locator('[data-form-card="our-public-form-v2"]')).toContainText("From template");
  });
});

test.describe("JSON import preview", () => {
  async function exportBiobuzz(page: Page) {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export BIOBUZZ as JSON" }).click()]);
    return JSON.parse(readFileSync((await download.path())!, "utf8"));
  }
  async function startImport(page: Page, json: unknown) {
    await page.getByTestId("new-form").click();
    await page.getByRole("radio", { name: /Import JSON/ }).click();
    await page.getByLabel("Form JSON").fill(typeof json === "string" ? json : JSON.stringify(json));
    await page.getByRole("button", { name: "Check file" }).click();
    return page.getByTestId("import-preview");
  }

  test("previews what will be created before anything is, then creates the draft", async ({ page }) => {
    await open(page);
    const json = await exportBiobuzz(page);
    const preview = await startImport(page, json);
    await expect(preview).toHaveAttribute("data-state", "ok");
    await expect(preview).toContainText("This will create one draft form");
    await expect(preview).toContainText("BIOBUZZ");
    await expect(preview.getByRole("list", { name: "Categories to create" })).toContainText("Autonomous");
    await expect(preview).toContainText("scoring field");
    expect(await audit(page)).toEqual([]); // nothing was created yet
    await page.getByRole("dialog").getByRole("button", { name: "Create form" }).click();
    await expect(page.getByTestId("builder-title")).toHaveText("BIOBUZZ");
    expect((await audit(page)).map((a) => a.action)).toContain("create-form");
  });

  test("strips HTML and warns about a checksum that doesn't match", async ({ page }) => {
    await open(page);
    const json = await exportBiobuzz(page);
    json.form.description = "The <b>2026</b> season form";
    const preview = await startImport(page, json);
    await expect(preview).toHaveAttribute("data-state", "ok");
    await expect(preview.getByRole("list", { name: "What was changed on the way in" })).toContainText("HTML was removed from 1 text");
    await expect(preview.getByRole("list", { name: "Warnings" })).toContainText("checksum doesn't match");
  });

  test("refuses unknown field types, links that aren't https and malformed files, with clear errors", async ({ page }) => {
    await open(page);
    const json = await exportBiobuzz(page);
    const userField = (j: typeof json) => j.form.sections.flatMap((s: { fields: { type: string; tip?: string }[] }) => s.fields).find((f: { type: string }) => !["matchPicker", "scoutName", "teamPicker"].includes(f.type));
    const bad = structuredClone(json);
    userField(bad).type = "hologram";
    delete bad.checksum;
    let preview = await startImport(page, bad);
    await expect(preview).toHaveAttribute("data-state", "refused");
    await expect(preview).toContainText("can't be imported");
    await expect(preview.getByRole("button", { name: "Fix automatically" })).toHaveCount(0);

    await preview.getByRole("button", { name: "Choose another file" }).click();
    const link = structuredClone(json);
    userField(link).tip = "More at http://example.com/help";
    delete link.checksum;
    await page.getByLabel("Form JSON").fill(JSON.stringify(link));
    await page.getByRole("button", { name: "Check file" }).click();
    preview = page.getByTestId("import-preview");
    await expect(preview).toContainText("isn't https");

    await preview.getByRole("button", { name: "Choose another file" }).click();
    await page.getByLabel("Form JSON").fill("{ not json");
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByTestId("import-preview")).toContainText("isn't valid JSON");
  });

  test("duplicate keys are refused, and can be fixed automatically with a note of what changed", async ({ page }) => {
    await open(page);
    const json = await exportBiobuzz(page);
    const fields = json.form.sections.flatMap((s: { fields: { key: string }[] }) => s.fields);
    const [a, b] = fields.filter((f: { key: string }) => !["match", "scoutName", "teamNumber"].includes(f.key));
    b.key = a.key;
    delete json.checksum;
    const preview = await startImport(page, json);
    await expect(preview).toHaveAttribute("data-state", "refused");
    await expect(preview).toContainText("must be unique");
    await preview.getByRole("button", { name: "Fix automatically" }).click();
    const fixed = page.getByTestId("import-preview");
    await expect(fixed).toHaveAttribute("data-state", "ok");
    await expect(fixed.getByRole("list", { name: "What was changed on the way in" })).toContainText(`Two fields used the key "${a.key}"`);
    await page.getByRole("dialog").getByRole("button", { name: "Create form" }).click();
    await expect(page.getByTestId("builder-title")).toBeVisible();
  });
});

test.describe("phone", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, "phone layout");
  });

  test("the library fits the screen and a template can be used", async ({ page }) => {
    await open(page);
    await openLibrary(page);
    await expect(card(page, "official-biobuzz")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Use template Pit scouting" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create draft form" }).click();
    await expect(page.getByTestId("builder-title")).toHaveText("Pit scouting");
  });
});

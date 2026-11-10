import { expect, test, type Page } from "@playwright/test";

// P29: the Pit Scout, Team Strategy and Helper forms (the real FormPageView) on /e2e/team-forms. Access to each page is proved by the page-access tests.

type Saved = { formType: string; teamNumber?: number | null; eventCode: string; values: Record<string, unknown>; stickyNotes: { text: string }[] };
type Updated = { id: string; values: Record<string, unknown>; stickyNotes: { text: string }[] };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function open(page: Page, query: string) {
  await page.goto(`/e2e/team-forms?${query}`);
  await expect(page.getByTestId("form-page")).toBeVisible();
  await page.waitForFunction(() => Array.isArray((window as unknown as { __saved?: unknown[] }).__saved));
  await page.waitForTimeout(300);
}
const saved = (page: Page) => page.evaluate(() => (window as unknown as { __saved: Saved[] }).__saved);
const updated = (page: Page) => page.evaluate(() => (window as unknown as { __updated: Updated[] }).__updated);
const pickTeam = async (page: Page, n: number) => {
  await page.getByTestId("team-select").click();
  await page.getByTestId("team-search").fill(String(n));
  await page.locator(`[data-team='${n}']`).click();
};

test.describe("Pit Scout Form", () => {
  test("has the fields in order, and the capabilities grid doesn't offer Leave in Teleop/Endgame", async ({ page }) => {
    await open(page, "form=pit");
    const labels = await page.locator("[data-field-key]").evaluateAll((els) => els.map((e) => e.getAttribute("data-field-key")));
    expect(labels).toEqual(expect.arrayContaining(["eventCode", "teamNumber", "scoutName", "weight", "weightUnit", "rookie", "photos", "friendlyPit", "friendlyDrive", "capabilities", "capacity", "preloaded", "cycleTime", "autoCycle"]));
    // in the order the prompt gives them
    const order = ["weight", "weightUnit", "rookie", "photos", "friendlyPit", "friendlyDrive", "capabilities", "capacity", "preloaded", "cycleTime", "autoCycle"];
    expect(order.map((k) => labels.indexOf(k))).toEqual([...order.map((k) => labels.indexOf(k))].sort((a, b) => a - b));
    const grid = page.getByTestId("matrix-field");
    await expect(grid.locator("td[data-cell='leave_teleop']")).toHaveAttribute("data-disabled", "true");
    await expect(grid.getByRole("checkbox", { name: "Leave, Autonomous" })).toBeVisible();
    await expect(grid.getByRole("checkbox", { name: "Leave, Teleop/Endgame" })).toHaveCount(0);
    for (const row of ["Park", "Score into Hive", "Score into Garden", "Score into Flower"]) {
      await expect(grid.getByRole("checkbox", { name: `${row}, Autonomous` })).toBeVisible();
      await expect(grid.getByRole("checkbox", { name: `${row}, Teleop/Endgame` })).toBeVisible();
    }
    await expect(page.getByTestId("notes-tab")).toBeVisible(); // sticky notes are on
  });

  test("suggests the rookie checkbox from FIRST's rookie year, and lets the scout change it", async ({ page }) => {
    await open(page, "form=pit");
    await pickTeam(page, 111); // rookie year 2025 = this season
    await expect(page.getByRole("checkbox", { name: "Rookie team" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("hint-rookie")).toContainText("rookie year 2025");
    await page.getByRole("checkbox", { name: "Rookie team" }).click(); // the scout knows better
    await expect(page.getByRole("checkbox", { name: "Rookie team" })).toHaveAttribute("aria-checked", "false");
    await pickTeam(page, 222); // a veteran: suggested not rookie
    await expect(page.getByRole("checkbox", { name: "Rookie team" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("hint-rookie")).toContainText("rookie year 2015");
    await pickTeam(page, 333); // no rookie year in the data: nothing suggested
    await expect(page.getByTestId("hint-rookie")).toHaveCount(0);
  });

  test("the auto cycle outliner: Leave first, Park last, the rest repeat and move; saved with a text summary", async ({ page }) => {
    await open(page, "form=pit");
    const seq = page.getByTestId("sequence-field");
    await seq.getByTestId("seq-add-hive").click();
    await seq.getByTestId("seq-add-park").click();
    await seq.getByTestId("seq-add-leave").click(); // added last, goes first
    await seq.getByTestId("seq-add-garden").click();
    await seq.getByTestId("seq-add-hive").click(); // hive can repeat
    await expect(seq.getByTestId("seq-summary")).toHaveText("Leave → Hive → Garden → Hive → Park");
    await expect(seq.getByTestId("seq-add-leave")).toBeDisabled();
    await expect(seq.getByTestId("seq-add-park")).toBeDisabled();
    await seq.getByRole("button", { name: /Move Grab Pollen\/Nectar From Garden \(step 3\) earlier/ }).click();
    await expect(seq.getByTestId("seq-summary")).toHaveText("Leave → Garden → Hive → Hive → Park");
    await expect(seq.getByTestId("seq-chip-0").getByRole("button", { name: /later/ })).toHaveCount(0); // Leave is pinned
    await pickTeam(page, 222);
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry.values.autoCycle).toEqual(["leave", "garden", "hive", "hive", "park"]);
  });

  test("weight and unit are stored together: lb by default, kg when toggled", async ({ page }) => {
    await open(page, "form=pit");
    await expect(page.getByRole("radio", { name: "lb" })).toHaveAttribute("aria-checked", "true");
    await page.getByLabel("Robot weight").fill("11.5");
    await page.getByRole("radio", { name: "kg" }).click();
    await page.getByLabel(/Approximate cycle time/).fill("12.5");
    await page.getByLabel(/how many pollen\/nectar can the robot hold/).fill("6");
    await page.getByLabel(/how many are preloaded/).fill("2");
    await page.getByRole("checkbox", { name: "Friendly and easy to work with in the pit" }).click();
    await pickTeam(page, 333);
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry).toMatchObject({ formType: "pit-scout", teamNumber: 333, eventCode: "EVT1" });
    expect(entry.values).toMatchObject({ weight: 11.5, weightUnit: "kg", cycleTime: 12.5, capacity: 6, preloaded: 2, friendlyPit: true, friendlyDrive: false });
  });

  test("photos: shown as waiting while offline, uploaded when the connection returns, up to 3, and saved with the entry", async ({ page, context }) => {
    await open(page, "form=pit");
    const field = page.getByTestId("photo-field-photos");
    await pickTeam(page, 222);
    await context.setOffline(true);
    await field.getByTestId("photo-input").setInputFiles({ name: "robot.png", mimeType: "image/png", buffer: PNG });
    await expect(field.getByTestId("photo-pending")).toBeVisible();
    await expect(field).toContainText("offline");
    await page.waitForTimeout(1500); // still waiting: the upload can't happen offline
    await expect(field.getByTestId("photo-thumb")).toHaveCount(0);
    await context.setOffline(false);
    await expect(field.getByTestId("photo-thumb")).toHaveCount(1, { timeout: 20000 });
    await expect(field.getByTestId("photo-pending")).toHaveCount(0);
    for (const name of ["two.png", "three.png"]) await field.getByTestId("photo-input").setInputFiles({ name, mimeType: "image/png", buffer: PNG });
    await expect(field.getByTestId("photo-thumb")).toHaveCount(3, { timeout: 20000 });
    await expect(field.getByTestId("photo-add")).toHaveCount(0); // 3 is the limit
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect((entry.values.photos as unknown[]).length).toBe(3);
  });

  test("a photo still uploading when the form is submitted doesn't hold it up", async ({ page, context }) => {
    await open(page, "form=pit");
    await pickTeam(page, 222);
    await context.setOffline(true);
    await page.getByTestId("photo-field-photos").getByTestId("photo-input").setInputFiles({ name: "robot.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("photo-pending")).toBeVisible();
    await page.getByTestId("submit-form").click();
    await expect(page.getByTestId("submit-success")).toBeVisible();
    const [entry] = await saved(page);
    expect(entry.values.photos).toEqual([]); // saved without it; it attaches to the entry when it finishes
    await context.setOffline(false);
  });
});

test.describe("Team Strategy Form", () => {
  test("best at, four ability checkboxes and notes, saved for the chosen team", async ({ page, isMobile }) => {
    await open(page, "form=strategy");
    await pickTeam(page, 222);
    await page.getByRole("combobox", { name: /Best at/ }).click();
    await expect(page.getByRole("option", { name: "Gathering" })).toBeVisible();
    expect(await page.getByRole("listbox").getByRole("option").allTextContents()).toEqual(["Hive", "Flower", "Garden", "Gathering", "Defense"]);
    await page.getByRole("option", { name: "Defense" }).click();
    for (const label of ["Can score in Hive", "Can score in Flower", "Shoot while intaking", "Shoot while moving"]) await expect(page.getByRole("checkbox", { name: label })).toBeVisible();
    await page.getByRole("checkbox", { name: "Shoot while moving" }).click();
    await page.getByTestId("notes-tab").click();
    await page.getByTestId("note-add").click();
    await page.getByRole("textbox", { name: "Note" }).first().fill("great driver");
    if (isMobile) await page.getByTestId("notes-close").click(); // the phone's notes sheet covers the submit bar
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry).toMatchObject({ formType: "team-strategy", teamNumber: 222 });
    expect(entry.values).toMatchObject({ bestAt: "defense", shootWhileMoving: true, canScoreHive: false });
    expect(entry.stickyNotes.map((n) => n.text)).toEqual(["great driver"]);
  });

  test("won't submit without a team", async ({ page }) => {
    await open(page, "form=strategy");
    await page.getByTestId("submit-form").click();
    await expect(page.getByText("Choose a team.")).toBeVisible();
    expect(await saved(page)).toEqual([]);
  });
});

test.describe("Helper Form", () => {
  test("with one active event the event picker is left out; the team helped, the result and the issue are required", async ({ page }) => {
    await open(page, "form=helper");
    await expect(page.locator("#form-event")).toHaveCount(0);
    await page.getByTestId("submit-form").click();
    await expect(page.getByText("Choose a team.")).toBeVisible();
    await expect(page.getByText("Was the scout successful with the pit assistance? is required.")).toBeVisible();
    await expect(page.getByText("Issue(s) they attempted to solve is required.")).toBeVisible();
    expect(await saved(page)).toEqual([]);
    await pickTeam(page, 111);
    await page.getByRole("radio", { name: "Yes" }).click();
    await page.getByLabel(/Issue\(s\) they attempted to solve/).fill("Loose intake belt");
    await page.getByTestId("submit-form").click();
    const [entry] = await saved(page);
    expect(entry).toMatchObject({ formType: "helper", teamNumber: 111, eventCode: "EVT1" });
    expect(entry.values).toMatchObject({ successful: "yes", issues: "Loose intake belt" });
  });

  test("with several active events the picker is shown", async ({ page }) => {
    await open(page, "form=helper&events=2");
    await expect(page.locator("#form-event")).toBeVisible();
  });
});

test.describe("one entry per team: edit previous or submit another", () => {
  test("choosing a team I already submitted for offers both, with the other scouts counted", async ({ page }) => {
    await open(page, "form=strategy&mine=1");
    await pickTeam(page, 111);
    await expect(page.getByTestId("already-submitted")).toHaveCount(0);
    await pickTeam(page, 222);
    const banner = page.getByTestId("already-submitted");
    await expect(banner).toContainText("You already submitted for this team");
    await expect(banner).toContainText("1 other scout has too");

    // Submit another: the banner goes away and a new entry is saved
    await page.getByTestId("submit-another").click();
    await expect(banner).toHaveCount(0);
    await page.getByTestId("submit-form").click();
    expect((await saved(page)).length).toBe(1);
    expect((await updated(page)).length).toBe(0);
  });

  test("Edit previous loads the earlier answers and notes, and saving updates that entry (not a new one)", async ({ page, isMobile }) => {
    await open(page, "form=strategy&mine=1");
    await pickTeam(page, 222);
    await page.getByTestId("edit-previous").click();
    await expect(page.getByTestId("editing-banner")).toContainText("Editing your earlier entry for team 222");
    await expect(page.getByRole("combobox", { name: /Best at/ })).toContainText("Hive");
    await page.getByTestId("notes-tab").click();
    await expect(page.getByRole("textbox", { name: "Note" }).first()).toHaveValue("earlier note");
    if (isMobile) await page.getByTestId("notes-close").click();
    await page.getByRole("checkbox", { name: "Can score in Hive" }).click();
    await expect(page.getByTestId("submit-form")).toHaveText(/Save changes/);
    await page.getByTestId("submit-form").click();
    await expect(page.getByTestId("submit-success")).toBeVisible();
    expect(await saved(page)).toEqual([]);
    const [edit] = await updated(page);
    expect(edit.id).toBe("mine-1");
    expect(edit.values).toMatchObject({ bestAt: "hive", canScoreHive: true });
    expect(edit.stickyNotes.map((n) => n.text)).toEqual(["earlier note"]);
    await expect(page.getByTestId("editing-banner")).toHaveCount(0); // back to a clean form
  });

  test("Cancel leaves edit mode without saving", async ({ page }) => {
    await open(page, "form=strategy&mine=1");
    await pickTeam(page, 222);
    await page.getByTestId("edit-previous").click();
    await page.getByTestId("cancel-edit").click();
    await expect(page.getByTestId("editing-banner")).toHaveCount(0);
    expect(await updated(page)).toEqual([]);
  });
});

test.describe("my assigned teams", () => {
  test("quick-pick with checkmarks and a progress count; hidden when there are none", async ({ page }) => {
    await open(page, "form=pit&assigned=1");
    await expect(page.getByTestId("assigned-progress")).toHaveText("1 of 3 done");
    await expect(page.getByTestId("assigned-111")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("assigned-222")).not.toHaveAttribute("data-done", "true");
    await page.getByTestId("assigned-222").click();
    await expect(page.getByTestId("team-select")).toContainText("222");
  });

  test("hidden when nothing is assigned", async ({ page }) => {
    await open(page, "form=pit");
    await expect(page.getByTestId("assigned-teams")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test("the submit bar stays on screen without scrolling, and nothing sticks out sideways", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone only");
    await open(page, "form=pit");
    await expect(page.getByTestId("submit-form")).toBeInViewport();
    const box = (await page.getByTestId("submit-form").boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});

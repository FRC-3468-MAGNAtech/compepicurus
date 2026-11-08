import { expect, test, type Page } from "@playwright/test";

// FIX4: the Selected events panel on /e2e/event-panel (real component, in-memory events): reorder by drag, arrows and the star, the primary is always first,
// and the condensed bar shows the same format (the event code) for every event without moving anything.

async function open(page: Page, query = "") {
  await page.goto(`/e2e/event-panel${query}`);
  await expect(page.getByTestId("selected-events-list")).toBeVisible();
  await page.waitForTimeout(400); // hydrated and settled (the cards fade in)
}

const order = (page: Page) => page.getByTestId("order").locator("li").allTextContents();
const listed = (page: Page) =>
  page
    .getByTestId("selected-events-list")
    .locator("> li")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")?.replace("selected-event-", "")));

test.describe("reordering the selected events", () => {
  test("move buttons reorder, and the first event is always the primary", async ({ page }) => {
    await open(page);
    expect(await order(page)).toEqual(["USWABON1", "USWASEQ", "USWATAC"]);
    await expect(page.getByRole("button", { name: "Move Bonney Lake Qualifier up" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Tacoma Championship down" })).toBeDisabled();

    await page.getByRole("button", { name: "Move Tacoma Championship up" }).click();
    expect(await order(page)).toEqual(["USWABON1", "USWATAC", "USWASEQ"]);
    await expect(page.getByTestId("primary")).toHaveAttribute("data-code", "USWABON1"); // a middle move keeps the primary
    await expect(page.getByTestId("primary-note")).toHaveCount(0);

    await page.getByRole("button", { name: "Move Tacoma Championship up" }).click();
    expect(await order(page)).toEqual(["USWATAC", "USWABON1", "USWASEQ"]);
    await expect(page.getByTestId("primary")).toHaveAttribute("data-code", "USWATAC"); // moved to first: primary
    await expect(page.getByTestId("primary-note")).toContainText("Tacoma Championship is now the primary event");
  });

  test("the star means move to first", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Make Sequim League Meet the primary event" }).click();
    expect(await order(page)).toEqual(["USWASEQ", "USWABON1", "USWATAC"]);
    await expect(page.getByTestId("primary")).toHaveAttribute("data-code", "USWASEQ");
    await expect(page.getByTestId("primary-note")).toContainText("Sequim League Meet is now the primary event");
    await expect.poll(() => listed(page)).toEqual(["USWASEQ", "USWABON1", "USWATAC"]);
  });

  test("moving the primary down hands primary to the next event", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Move Bonney Lake Qualifier down" }).click();
    expect(await order(page)).toEqual(["USWASEQ", "USWABON1", "USWATAC"]);
    await expect(page.getByTestId("primary")).toHaveAttribute("data-code", "USWASEQ");
  });

  test("dragging an event onto the first place makes it primary, with a confirmation", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "mouse drag: touch uses the arrows (covered above)");
    await open(page);
    const grip = page.getByRole("button", { name: "Drag Tacoma Championship to reorder" });
    const target = page.getByTestId("selected-event-USWABON1");
    const g = (await grip.boundingBox())!;
    const t = (await target.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 10, g.y + g.height / 2 - 10, { steps: 4 });
    await page.mouse.move(t.x + 30, t.y + 6, { steps: 14 });
    await page.mouse.up();
    await expect.poll(() => order(page)).toEqual(["USWATAC", "USWABON1", "USWASEQ"]);
    await expect(page.getByTestId("primary")).toHaveAttribute("data-code", "USWATAC");
    await expect(page.getByTestId("primary-note")).toContainText("is now the primary event");
  });

  test("the keyboard can reorder with the grip (space, arrows, space)", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await page.getByRole("button", { name: "Drag Sequim League Meet to reorder" }).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(250); // the sensor attaches its key listeners a tick after activation
    await page.keyboard.press("ArrowLeft"); // two columns on a wide screen: the first card is to the left
    await page.waitForTimeout(450);
    await page.keyboard.press("Space");
    await expect.poll(() => order(page)).toEqual(["USWASEQ", "USWABON1", "USWATAC"]);
  });

  test("members (read-only) get no reorder controls, and a single event has nothing to reorder", async ({ page }) => {
    await open(page, "?readonly=1");
    await expect(page.getByRole("button", { name: /^Drag / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move .* (up|down)$/ })).toHaveCount(0);
    await open(page, "?events=1");
    await expect(page.getByRole("button", { name: /^Drag / })).toHaveCount(0);
  });
});

test.describe("the condensed bar", () => {
  test("shows the event code for every event (name in the tooltip), and nothing below moves", async ({ page }) => {
    await open(page);
    const before = (await page.getByTestId("below").boundingBox())!;
    await page.evaluate(() => window.scrollTo(0, 700));
    const bar = page.getByRole("button", { name: "Selected events" });
    await expect(bar).toBeVisible();
    const chips = bar.locator("span[title]");
    await expect(chips).toHaveCount(3);
    expect(await chips.allTextContents()).toEqual(["USWABON1", "USWASEQ", "USWATAC"]);
    expect(await chips.evaluateAll((els) => els.map((el) => el.getAttribute("title")))).toEqual(["Bonney Lake Qualifier", "Sequim League Meet", "Tacoma Championship"]);
    // the bar floats in a zero-height slot: the page below the panel is exactly where it was (document position)
    const after = (await page.getByTestId("below").boundingBox())!;
    expect(Math.abs(after.y + 700 - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    // and the full names are in the expanded popover
    await bar.click();
    await expect(page.getByText("Tacoma Championship").last()).toBeVisible();
  });

  test("follows the new order", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Make Tacoma Championship the primary event" }).click();
    await page.evaluate(() => window.scrollTo(0, 700));
    const chips = page.getByRole("button", { name: "Selected events" }).locator("span[title]");
    await expect.poll(async () => chips.allTextContents()).toEqual(["USWATAC", "USWABON1", "USWASEQ"]);
  });
});

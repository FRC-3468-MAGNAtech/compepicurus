import { expect, test } from "@playwright/test";
import { openFixture } from "./helpers";

// P19: the sidebar's FTC team display and switcher. The fixture page feeds the real sidebar two FTC teams
// (35792 "Alpha Bots", 35794 "Beta Builders") and the account name "Test Robotics" with no Firebase.

const asideOf = (page: import("@playwright/test").Page) => page.locator("aside:visible").first();

test.describe("sidebar FTC team display (P19)", () => {
  test("shows the active team's number and name, never the old hard-coded label, and the account name", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop sidebar (the drawer is covered below)");
    await openFixture(page);
    const aside = asideOf(page);
    const switcher = aside.getByTestId("field-team-switcher");
    await expect(switcher).toContainText("FTC 35792");
    await expect(switcher).toContainText("Alpha Bots");
    await expect(aside).toContainText("Test Robotics");
    await expect(aside).not.toContainText("3468");
    await expect(aside).not.toContainText("FRC");
    // it fits inside the sidebar's glass panel
    const panel = (await aside.locator("> div").first().boundingBox())!;
    const box = (await switcher.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(panel.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
  });

  test("the switcher lists the user's teams, switches, remembers the choice, and closes with Escape", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop sidebar");
    await openFixture(page);
    const aside = asideOf(page);
    const switcher = aside.getByTestId("field-team-switcher");

    await switcher.click();
    const list = page.getByRole("listbox", { name: "Your FTC teams" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(list.getByRole("option", { name: /35792/ })).toHaveAttribute("aria-selected", "true");
    // the popover is legible: the design system's high-opacity overlay backing (glass-overlay, >= 0.9 alpha), not see-through glass
    const alpha = await list.evaluate((el) => {
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      const parts = (m?.[1] ?? "").split(/[,\s/]+/).filter(Boolean);
      return parts.length > 3 ? Number(parts[3]) : 1;
    });
    expect(alpha, "popover backing must be high-opacity").toBeGreaterThanOrEqual(0.9);

    await list.getByRole("option", { name: /35794/ }).click();
    await expect(list).toBeHidden();
    await expect(switcher).toContainText("FTC 35794");
    await expect(switcher).toContainText("Beta Builders");

    // reopen: the choice is the selected one; Escape closes and hands focus back
    await switcher.click();
    await expect(page.getByRole("listbox").getByRole("option", { name: /35794/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(switcher).toBeFocused();
  });

  test("is keyboard operable: arrows move between teams, Enter chooses", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop sidebar");
    await openFixture(page);
    const switcher = asideOf(page).getByTestId("field-team-switcher");
    await switcher.focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("listbox", { name: "Your FTC teams" });
    await expect(list.getByRole("option", { name: /35792/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(list.getByRole("option", { name: /35794/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(switcher).toContainText("FTC 35794");
  });

  test("collapsed, it is just the number and still switches", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop sidebar");
    await openFixture(page);
    await page.getByTestId("sidebar-collapse").click();
    await expect.poll(async () => Math.round((await asideOf(page).boundingBox())!.width)).toBe(84);
    const switcher = asideOf(page).getByTestId("field-team-switcher");
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveText("35792");
    const panel = (await asideOf(page).locator("> div").first().boundingBox())!;
    const box = (await switcher.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(panel.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);

    await switcher.click();
    await page.getByRole("listbox").getByRole("option", { name: /35794/ }).click();
    await expect(switcher).toHaveText("35794");
  });

  test("the mobile drawer has the same switcher", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layouts use the drawer");
    await openFixture(page);
    await page.getByRole("button", { name: /menu/i }).first().click();
    // the (CSS-hidden) desktop sidebar is still in the DOM, so scope to the visible one: the drawer
    const switcher = asideOf(page).getByTestId("field-team-switcher");
    await expect(switcher).toBeVisible();
    await expect(switcher).toContainText("FTC 35792");
    await switcher.click();
    await page.getByRole("listbox").getByRole("option", { name: /35794/ }).click();
    await expect(switcher).toContainText("FTC 35794");
  });
});

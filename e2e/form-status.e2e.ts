import { expect, test, type Page } from "@playwright/test";

// P30: Scout Status for the other form types (the real FormStatusView on seeded inputs). The logic is covered by lib/scout-status/form-status.test.ts.

async function open(page: Page, query: string) {
  await page.goto(`/e2e/form-status?${query}`);
  await page.waitForFunction(() => Array.isArray((window as unknown as { __targets?: unknown[] }).__targets));
  await page.waitForTimeout(200);
}

test.describe("alliance types", () => {
  test("Lead Scout: Red and Blue of each match are checked off, the scout table counts alliances", async ({ page }) => {
    await open(page, "type=lead-scout");
    await expect(page.getByTestId("alliances-done")).toContainText("3");
    await expect(page.getByTestId("alliances-done")).toContainText("of 4");
    await expect(page.getByTestId("cov-Q1-red")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("cov-Q1-blue")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("cov-Q2-red")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("cov-Q2-blue")).toHaveAttribute("data-done", "false");
    const ada = page.getByTestId("status-row-u1");
    await expect(ada).toContainText("2"); // two alliances
    await expect(ada).toContainText("3"); // target
    await expect(ada).toContainText("Behind"); // 2 of 3 with every match played
    await expect(page.getByTestId("status-row-u2")).toContainText("Behind");
    // no accuracy anywhere
    await expect(page.getByText(/accuracy/i).first()).toContainText("Accuracy doesn't apply");
    await expect(page.getByRole("columnheader", { name: /Accuracy/ })).toHaveCount(0);
  });

  test("Drive Reflection: a plan with no reflection is marked, and so is the difference count", async ({ page }) => {
    await open(page, "type=drive-reflection");
    await expect(page.getByTestId("plan-gaps")).toHaveText("1"); // Q1 blue was planned, never reflected on
    await expect(page.getByTestId("cov-Q1-blue")).toHaveAttribute("data-plan-gap", "true");
    await expect(page.getByTestId("cov-Q1-red")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("diff-Q1-red")).toHaveText("2 diff");
    await expect(page.getByTestId("cov-Q2-red")).toHaveAttribute("data-plan-gap", "false"); // nobody planned Q2
  });

  test("Match Strategy: the same alliance checks", async ({ page }) => {
    await open(page, "type=match-strategy");
    await expect(page.getByTestId("alliances-done")).toContainText("2");
  });
});

test.describe("team types", () => {
  test("Pit Scout: the team grid with checks and a photo, our own team left out until asked", async ({ page }) => {
    await open(page, "type=pit-scout");
    await expect(page.getByTestId("teams-done")).toContainText("2");
    await expect(page.getByTestId("teams-done")).toContainText("of 3"); // 222 is ours: left out
    await expect(page.getByTestId("team-cell-222")).toHaveCount(0);
    await expect(page.getByTestId("team-cell-111")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("team-photo-111")).toBeVisible(); // pit shows the photo
    await expect(page.getByTestId("team-cell-444")).toHaveAttribute("data-done", "false");
    await page.getByTestId("include-ours").check();
    await expect(page.getByTestId("team-cell-222")).toBeVisible();
    await expect(page.getByTestId("teams-done")).toContainText("of 4");
  });

  test("Team Strategy shows no photo thumbnails", async ({ page }) => {
    await open(page, "type=team-strategy");
    await expect(page.getByTestId("team-cell-111")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("team-photo-111")).toHaveCount(0);
  });

  test("one teams-per-scout number for everyone, with a progress status; Complete once met", async ({ page }) => {
    await open(page, "type=pit-scout&all=1");
    await expect(page.getByTestId("status-row-u1")).toContainText("Complete"); // 1 team of 1
    await page.getByLabel("Teams per scout, everyone").fill("3");
    await page.getByLabel("Teams per scout, everyone").blur();
    await expect(page.getByTestId("status-row-u1")).not.toContainText("Complete");
    expect(await page.evaluate(() => (window as unknown as { __targets: unknown[] }).__targets)).toEqual([{ kind: "all", value: 3 }]);
  });

  test("targets prefill from assignments, labelled, and a manual number overrides one scout", async ({ page }) => {
    await open(page, "type=pit-scout&assigned=1&all=5");
    await expect(page.getByTestId("target-source-u1")).toHaveText("from assignments");
    await expect(page.getByLabel("Target for Ada Lovelace")).toHaveValue("2");
    await expect(page.getByLabel("Target for Ben Franklin")).toHaveValue("5"); // the everyone number
    await page.getByLabel("Target for Ada Lovelace").fill("9");
    await page.getByLabel("Target for Ada Lovelace").blur();
    await expect(page.getByTestId("target-source-u1")).toHaveText("manual");
    await expect(page.getByLabel("Target for Ada Lovelace")).toHaveValue("9");
  });
});

test.describe("Helper", () => {
  test("is a count-only table per person", async ({ page }) => {
    await open(page, "type=helper");
    await expect(page.getByTestId("status-row-u1")).toContainText("2");
    await expect(page.getByTestId("status-row-u1")).toContainText("1"); // one successful
    await expect(page.getByTestId("status-row-u2")).toContainText("1");
    await expect(page.getByText("Target", { exact: true })).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test("nothing sticks out of the page", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone only");
    for (const type of ["lead-scout", "pit-scout", "helper"]) {
      await open(page, `type=${type}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), type).toBeLessThanOrEqual(1);
    }
  });
});

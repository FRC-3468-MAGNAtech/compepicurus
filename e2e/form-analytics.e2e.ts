import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// P30: the six new Analytics pages (the real FormAnalyticsView) on /e2e/form-analytics, on seeded entries. Who may open the pages is the open "analytics" page access
// (proved by the page-access tests); the rules tests prove only admins flag, exclude and delete.

async function open(page: Page, query: string) {
  await page.goto(`/e2e/form-analytics?${query}`);
  await page.waitForFunction(() => Array.isArray((window as unknown as { __entries?: unknown[] }).__entries));
  await page.waitForTimeout(250);
}
const rows = (page: Page) => page.getByTestId("analytics-row");
const teamsShown = async (page: Page) => (await rows(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-team"))))).sort((a, b) => a - b);

test.describe("raw table", () => {
  test("a team-based form: sticky Team and Scout, a three-tier header, one row per entry, the entry count", async ({ page }) => {
    await open(page, "page=pit-scout");
    await expect(page.getByRole("heading", { name: "Pit Scout Analytics" })).toBeVisible();
    // EVT1 only: team 111 and team 222 (twice)
    expect(await teamsShown(page)).toEqual([111, 222, 222]);
    await expect(page.getByText("3 entries")).toBeVisible();
    // the header's three tiers: phase (section), category, label
    await expect(page.getByText("Robot", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Team/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Scout/ })).toBeVisible();
    // no Match column on a pit form, no score or accuracy columns
    await expect(page.getByRole("button", { name: /^Match/ })).toHaveCount(0);
    await expect(page.getByText("Alliance Accuracy")).toHaveCount(0);
    await expect(page.getByText("Event", { exact: true })).toHaveCount(0); // one event: no Event column
  });

  test("several events add an Event column", async ({ page }) => {
    await open(page, "page=pit-scout&events=2");
    expect(await teamsShown(page)).toEqual([111, 222, 222, 333]);
    await expect(page.getByRole("button", { name: /^Event/ })).toBeVisible();
  });

  test("a match-based form has Match and Alliance and no Team column", async ({ page }) => {
    await open(page, "page=lead-scout");
    await expect(page.getByRole("button", { name: /^Match/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Alliance/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Team$/ })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
  });

  test("sort by a column, search, and Hide Names", async ({ page }) => {
    await open(page, "page=pit-scout");
    await page.getByRole("button", { name: /^Team/ }).click(); // already sorted ascending by team: this flips it
    expect(await rows(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-team"))))).toEqual([222, 222, 111]);
    await page.getByPlaceholder("Search this analytics page...").fill("ben");
    expect(await teamsShown(page)).toEqual([222, 222]);
    await page.getByPlaceholder("Search this analytics page...").fill("");
    await expect(rows(page).first()).toContainText(/Ada Lovelace|Ben Franklin/);
    await page.getByText("Hide Names").click();
    await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
    await expect(page.getByText("Scout 1").first()).toBeVisible();
  });

  test("the notes column is one collapsed line that expands", async ({ page }) => {
    await open(page, "page=pit-scout");
    await expect(page.getByText("tall robot").first()).toBeVisible();
  });

  test("an empty page and a loading page say so", async ({ page }) => {
    await open(page, "page=helper&entries=none");
    await expect(page.getByTestId("analytics-empty")).toContainText("No Helper entries yet for this event");
    await open(page, "page=helper&loaded=0");
    await expect(page.getByTestId("analytics-skeleton")).toBeVisible();
  });

  test("on a phone nothing sticks out of the page", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone only");
    await open(page, "page=pit-scout&view=summary");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await open(page, "page=pit-scout");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("summary views", () => {
  test("Pit Scout: the latest entry per team, photos open in a lightbox, the capabilities grid and the auto cycle flow; See all shows the earlier ones", async ({ page }) => {
    await open(page, "page=pit-scout&view=summary");
    await expect(page.getByTestId("pit-card-111")).toBeVisible();
    await expect(page.locator("[data-testid^='pit-card-']")).toHaveCount(2); // 111 and the latest 222
    const card = page.getByTestId("pit-card-111");
    await expect(card.getByTestId("pit-gallery").locator("img")).toHaveCount(2);
    await card.getByRole("button", { name: "Open photo 2 of team 111" }).click();
    await expect(page.getByTestId("lightbox")).toContainText("Photo 2 of 2");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lightbox")).toHaveCount(0);
    const grid = card.getByTestId("capability-grid");
    await expect(grid.locator("[data-cell='hive_auto']")).toHaveAttribute("data-on", "true");
    await expect(grid.locator("[data-cell='garden_auto']")).toHaveAttribute("data-on", "false");
    await expect(grid.locator("[data-cell='leave_teleop']")).toContainText("n/a");
    await expect(card.getByTestId("auto-flow")).toContainText("Leave > Hive > Garden > Hive > Park");
    await expect(card).toContainText("24.5 lb");
    await expect(card).toContainText("12.5 s");
    // team 222's latest entry (10 kg = 22 lb, 18 s), not the earlier one
    await expect(page.getByTestId("pit-card-222")).toContainText("22 lb");
    await expect(page.getByTestId("pit-card-222")).not.toContainText("30 s");
    await page.getByTestId("see-all-toggle").click();
    await expect(page.locator("[data-testid^='pit-card-']")).toHaveCount(3);
  });

  test("Lead Scout: average skill per team, with the notes, and the alliances", async ({ page }) => {
    await open(page, "page=lead-scout&view=summary");
    const row = page.getByTestId("lead-team-111");
    await expect(row).toContainText("4.0"); // (5 + 3) / 2
    await expect(row).toContainText("fast cycles");
    await expect(page.getByTestId("lead-team-444")).toContainText("1.0");
    await expect(page.getByText("solid alliance")).toBeVisible();
  });

  test("Team Strategy: the teams per best-at and the ability table", async ({ page }) => {
    await open(page, "page=team-strategy&view=summary");
    await expect(page.getByTestId("best-count-defense")).toContainText("2");
    await expect(page.getByTestId("best-count-hive")).toContainText("1");
    await expect(page.getByTestId("best-count-garden")).toContainText("0");
    await expect(page.getByTestId("strategy-row-222")).toContainText("Defense");
    await expect(page.getByTestId("strategy-row-111").getByLabel("Yes")).toHaveCount(1); // can score in Hive
  });

  test("Match Strategy: the planned roles as chips per match and alliance", async ({ page }) => {
    await open(page, "page=match-strategy&view=summary");
    const q1 = page.getByTestId("plan-Q1-red");
    await expect(q1).toContainText("111");
    await expect(q1).toContainText("Hive");
    await expect(q1).toContainText("Auto"); // team 111 will score in auto
    await expect(q1).toContainText("Defense");
    await expect(page.getByTestId("plan-Q2-blue")).toContainText("Garden");
  });

  test("Drive Reflection: plan against actual, a caution on the one that differed, and the % that went to plan", async ({ page }) => {
    await open(page, "page=drive-reflection&view=summary");
    await expect(page.getByTestId("went-to-plan")).toHaveText("50%");
    const q1 = page.getByTestId("reflection-Q1-red");
    await expect(q1.getByTestId("plan-caution")).toContainText("1 difference from the plan");
    await expect(q1).toContainText("Defense"); // planned
    await expect(q1).toContainText("Garden"); // actual
    await expect(page.getByTestId("reflection-Q2-blue")).toContainText("As planned");
    await expect(page.getByTestId("reflection-Q2-blue").getByTestId("plan-caution")).toHaveCount(0);
  });

  test("Helper: the success rate overall and per scout, and the log", async ({ page }) => {
    await open(page, "page=helper&view=summary");
    const summary = page.getByTestId("summary-helper");
    await expect(summary).toContainText("67%");
    await expect(page.getByTestId("helper-scout-0")).toContainText("Ada Lovelace");
    await expect(page.getByTestId("helper-scout-0")).toContainText("50%");
    await expect(page.getByTestId("helper-scout-1")).toContainText("100%");
    await expect(summary).toContainText("Loose intake belt");
    await page.getByText("Hide Names").click();
    await expect(page.getByTestId("helper-scout-0")).toContainText("Scout 1");
  });
});

test.describe("admin tools", () => {
  test("a non-admin sees no Config, Delete or Import", async ({ page }) => {
    await open(page, "page=pit-scout");
    await expect(page.getByRole("button", { name: /Config/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete entry" })).toHaveCount(0);
    await expect(page.getByTestId("import-csv")).toHaveCount(0);
    await expect(page.getByTestId("export-csv")).toBeVisible();
  });

  test("an admin can exclude an entry through Config, and the row shows it", async ({ page }) => {
    await open(page, "page=pit-scout&admin=1");
    const row = page.locator("[data-testid='analytics-row'][data-team='111']");
    await row.getByRole("button", { name: /Config/ }).click();
    await page.getByRole("button", { name: /Exclude/ }).first().click();
    await page.keyboard.press("Escape");
    await expect(row).toHaveAttribute("data-excluded", "true");
    await page.getByTestId("view-summary").click();
    await expect(page.getByTestId("pit-card-111")).toHaveCount(0); // excluded entries leave the summary
  });

  test("an admin can delete an entry, after confirming", async ({ page }) => {
    await open(page, "page=pit-scout&admin=1");
    await rows(page).first().getByRole("button", { name: "Delete entry" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(rows(page)).toHaveCount(3);
    await rows(page).first().getByRole("button", { name: "Delete entry" }).click();
    await page.getByTestId("confirm-delete").click();
    await expect(rows(page)).toHaveCount(2);
  });

  test("CSV round trip: export, delete a row, import the file back: only the missing row is added", async ({ page }) => {
    await open(page, "page=pit-scout&admin=1");
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-csv").click();
    const download = await downloadPromise;
    const file = await download.path();
    const csv = readFileSync(file!, "utf8");
    expect(csv.split("\r\n")).toHaveLength(4); // header + 3 entries
    expect(csv).toContain("Leave → Hive → Garden → Hive → Park");

    await rows(page).first().getByRole("button", { name: "Delete entry" }).click();
    await page.getByTestId("confirm-delete").click();
    await expect(rows(page)).toHaveCount(2);

    await page.getByTestId("import-csv").click();
    await page.getByTestId("form-import-file").setInputFiles({ name: "pit.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByTestId("form-import-summary")).toContainText("1 new row to import, 2 duplicates skipped");
    await page.getByTestId("form-import-confirm").click();
    await expect(rows(page)).toHaveCount(3);
    const saved = await page.evaluate(() => (window as unknown as { __saved: { formType: string; eventCode: string; teamNumber?: number | null }[] }).__saved);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ formType: "pit-scout", eventCode: "EVT1" });
  });

  test("a wrong file is refused", async ({ page }) => {
    await open(page, "page=pit-scout&admin=1");
    await page.getByTestId("import-csv").click();
    await page.getByTestId("form-import-file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("Hello,World\r\n1,2") });
    await expect(page.getByTestId("form-import-errors")).toContainText("Missing expected column");
    await expect(page.getByTestId("form-import-confirm")).toHaveCount(0);
  });
});

test.describe("Team Profile: Pit and strategy", () => {
  test("shows the latest photos, cycle time, capacity, best at, lead scout skill and the links", async ({ page }) => {
    await open(page, "profile=111");
    const section = page.getByTestId("pit-and-strategy");
    await expect(section.getByTestId("profile-photos").locator("img")).toHaveCount(2);
    await expect(section).toContainText("12.5 s");
    await expect(section).toContainText("Hive"); // best at
    await expect(section).toContainText("4.0 / 5"); // (5 + 3) / 2 lead scout skill
    await expect(section.getByTestId("profile-abilities")).toContainText("Can score in Hive");
    await expect(section.getByTestId("auto-flow")).toContainText("Leave > Hive > Garden > Hive > Park");
    await expect(section.getByRole("link", { name: /Pit Scout Analytics/ })).toHaveAttribute("href", /\/analytics\/pit-scout/);
    await section.getByRole("button", { name: "Open photo 1 of team 111" }).click();
    await expect(page.getByTestId("lightbox")).toBeVisible();
  });

  test("is left out for a team with nothing", async ({ page }) => {
    await open(page, "profile=999");
    await expect(page.getByTestId("profile-hidden")).toBeVisible();
    await expect(page.getByTestId("pit-and-strategy")).toHaveCount(0);
  });
});

import { expect, test, type Page } from "@playwright/test";

// P31: the Pit Scouting / Team Strategy assignment editor (the real TeamAssignmentsView). The distribution itself is unit-tested in lib/team-assignments/distribute.test.ts.

async function open(page: Page, query = "") {
  await page.goto(`/e2e/team-assignments?${query}`);
  await page.waitForFunction(() => Array.isArray((window as unknown as { __published?: unknown[] }).__published));
  await page.waitForTimeout(200);
}
const totals = async (page: Page) => page.getByTestId("scout-totals").locator("li strong").allTextContents().then((xs) => xs.map(Number));
const published = (page: Page) => page.evaluate(() => (window as unknown as { __published: { teams: { teamNumber: number; scoutUids: string[]; locked: boolean }[]; settings: Record<string, unknown>; uneven: boolean }[] }).__published);

test.describe("an editor", () => {
  test("randomize hands every team (but our own) to a scout, balanced to within one", async ({ page }) => {
    await open(page);
    await expect(page.getByText("11 teams to cover")).toBeVisible(); // 12 teams, 100 is ours
    await page.getByTestId("randomize").click();
    await expect(page.getByTestId("team-draft")).toBeVisible();
    await expect(page.getByTestId("team-row-100")).toHaveCount(0);
    const t = await totals(page);
    expect(t.reduce((a, b) => a + b, 0)).toBe(11);
    expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("uneven-warning")).toHaveCount(0);
    await expect(page.getByTestId("randomize")).toHaveText(/Re-roll/);
  });

  test("including our own teams adds them", async ({ page }) => {
    await open(page);
    await page.getByTestId("include-ours").check();
    await expect(page.getByText("12 teams to cover")).toBeVisible();
    await page.getByTestId("randomize").click();
    await expect(page.getByTestId("team-row-100")).toBeVisible();
  });

  test("sequential blocks give each scout a run of team numbers", async ({ page }) => {
    await open(page);
    await page.getByLabel("How to hand them out").click();
    await page.getByRole("option", { name: /Sequential blocks/ }).click();
    await page.getByTestId("randomize").click();
    // 11 teams over 3 scouts: 4, 4, 3 in order (101-104 Ada, 105-108 Ben, 109-111 Cy)
    await expect(page.getByLabel("Scout for team 101", { exact: true })).toHaveValue("a");
    await expect(page.getByLabel("Scout for team 104", { exact: true })).toHaveValue("a");
    await expect(page.getByLabel("Scout for team 105", { exact: true })).toHaveValue("b");
    await expect(page.getByLabel("Scout for team 111", { exact: true })).toHaveValue("c");
    expect(await totals(page)).toEqual([4, 4, 3]);
  });

  test("priority teams get a second scout", async ({ page }) => {
    await open(page);
    await page.getByLabel(/Priority teams/).fill("103, 107, 999");
    await expect(page.getByText("2 priority teams in this event.")).toBeVisible(); // 999 isn't at the event
    await page.getByTestId("randomize").click();
    for (const t of [103, 107]) {
      await expect(page.getByLabel(`Second scout for team ${t}`)).not.toHaveValue("");
      await expect(page.getByTestId(`team-row-${t}`)).toContainText("Priority");
    }
    await expect(page.getByLabel("Second scout for team 104")).toHaveValue("");
    const t = await totals(page);
    expect(t.reduce((a, b) => a + b, 0)).toBe(13); // 11 teams + 2 second scouts
    expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(1);
  });

  test("a manual change locks the team, and a re-roll keeps it; uneven loads are warned about", async ({ page }) => {
    await open(page);
    await page.getByTestId("randomize").click();
    await page.getByLabel("Scout for team 105", { exact: true }).selectOption("c");
    await expect(page.getByTestId("team-row-105")).toHaveAttribute("data-locked", "true");
    for (let i = 0; i < 6; i++) {
      await page.getByTestId("randomize").click();
      await expect(page.getByLabel("Scout for team 105", { exact: true })).toHaveValue("c");
    }
    // unlocking lets it move: unlock, then hand every other team to one scout
    await page.getByLabel("Unlock team 105").click();
    await expect(page.getByTestId("team-row-105")).toHaveAttribute("data-locked", "false");
    for (let t = 101; t <= 111; t++) await page.getByLabel(`Scout for team ${t}`, { exact: true }).selectOption("a");
    await expect(page.getByTestId("uneven-warning")).toContainText("Uneven: 0 to 11 teams each");
  });

  test("an unassigned team is flagged, and clearing a scout unlocks it", async ({ page }) => {
    await open(page);
    await page.getByTestId("randomize").click();
    await page.getByLabel("Scout for team 101", { exact: true }).selectOption("");
    await expect(page.getByTestId("unassigned-warning")).toContainText("1 team unassigned");
    await expect(page.getByTestId("team-row-101")).toHaveAttribute("data-locked", "false");
  });

  test("a scout can be left out of the pool, and any member added (marked as having no access)", async ({ page }) => {
    await open(page);
    await page.getByRole("checkbox", { name: "Cy" }).uncheck();
    await page.getByTestId("randomize").click();
    expect(await totals(page)).toHaveLength(2);
    await page.getByLabel("Add any member").click();
    await page.getByRole("option", { name: "Di" }).click();
    await expect(page.getByTestId("scout-pool")).toContainText("no access");
    await page.getByTestId("randomize").click();
    expect(await totals(page)).toHaveLength(3);
  });

  test("publishing saves the draft and shows it; undo brings the previous one back", async ({ page }) => {
    await open(page, "published=1");
    await expect(page.getByTestId("team-published")).toContainText("Ada");
    await page.getByTestId("randomize").click();
    await page.getByTestId("publish").click();
    await expect(page.getByTestId("team-draft")).toHaveCount(0);
    await expect(page.getByTestId("team-published")).toBeVisible();
    const [v] = await published(page);
    expect(v.teams).toHaveLength(11);
    expect(v.settings).toMatchObject({ mode: "balanced-random", includeOurs: false, priorityCoverage: 2 });
    await expect(page.getByTestId("undo")).toBeVisible(); // the earlier version is the previous one
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("undo")).toHaveCount(0);
    await expect(page.getByTestId("team-published")).toContainText("Ada"); // the first published version again (101 → Ada)
  });

  test("the published assignment can be edited as a draft, every row locked", async ({ page }) => {
    await open(page, "published=1");
    await page.getByTestId("edit-published").click();
    await expect(page.getByTestId("team-row-101")).toHaveAttribute("data-locked", "true");
    await expect(page.getByLabel("Scout for team 101", { exact: true })).toHaveValue("a");
  });

  test("with nobody eligible, the page says so and Randomize is disabled", async ({ page }) => {
    await open(page, "none=1");
    await expect(page.getByText(/Nobody who is attending can open/)).toBeVisible();
    await expect(page.getByTestId("randomize")).toBeDisabled();
  });

  test("Team Strategy is the same editor with its own wording", async ({ page }) => {
    await open(page, "kind=teamStrategy");
    await expect(page.getByText("Team Strategy assignments")).toBeVisible();
  });
});

test.describe("a scout (read-only)", () => {
  test("sees only their own teams with progress and a link to the form, and can't edit", async ({ page }) => {
    await open(page, "published=1&edit=0&me=a&done=101");
    await expect(page.getByTestId("my-progress-pit")).toHaveText("1 of 3 done"); // Ada has 101, 102, 104
    await expect(page.getByTestId("my-team-101")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("my-team-102")).toHaveAttribute("data-done", "false");
    await expect(page.getByTestId("my-team-103")).toHaveCount(0); // Cy's
    await expect(page.getByTestId("randomize")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Open the Pit Scouting form/ })).toBeVisible();
  });

  test("nothing assigned yet, or no teams for me", async ({ page }) => {
    await open(page, "edit=0");
    await expect(page.getByText("Nothing has been assigned yet.")).toBeVisible();
    await open(page, "published=1&edit=0&me=d");
    await expect(page.getByText("You have no teams in this assignment.")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test("nothing sticks out of the page", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone only");
    await open(page);
    await page.getByTestId("randomize").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});

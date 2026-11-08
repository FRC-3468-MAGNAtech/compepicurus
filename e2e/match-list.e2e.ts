import { expect, test, type Page } from "@playwright/test";

// FIX4: the Match List on /e2e/match-list (the real screen on a fixed schedule; the clock is 11:00 at the event, Q13 is on the field, Q1-Q12 are played,
// our team 3468 plays Q5, Q13 and Q30 of Bonney Lake).

// The "Updated" time is shown in the viewer's own zone: pin it so the assertions are the same on every machine.
test.use({ timezoneId: "America/Los_Angeles" });

async function open(page: Page, query = "") {
  await page.goto(`/e2e/match-list${query}`);
  await expect(page.getByRole("heading", { name: "Match List" })).toBeVisible();
}

const labels = (page: Page, event = "USWABON1") => page.getByTestId(`match-group-${event}`).locator("li[data-testid^='match-']").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")!.replace("match-", "")));
async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
const inViewport = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });

test.describe("one event", () => {
  test("opens on Qualifications, scrolls to the next upcoming match, marks it, and shows status and scores", async ({ page }) => {
    await open(page, "?events=1");
    await expect(page.getByTestId("event-switcher")).toHaveCount(0); // a single event needs no switcher
    await expect(page.getByTestId("tab-qualification")).toHaveAttribute("data-state", "active");
    expect(await labels(page)).toHaveLength(40);

    // Q13 is on the field (its start has just passed), Q14 is the next upcoming match
    await expect(page.getByTestId("match-Q13")).toHaveAttribute("data-status", "in-progress");
    await expect(page.getByTestId("match-Q14")).toHaveAttribute("data-next", "true");
    await expect(page.getByTestId("match-Q14")).toContainText("Next");
    await expect(page.getByTestId("match-Q14")).toHaveAttribute("data-status", "upcoming");
    await expect(page.locator("[data-next='true']")).toHaveCount(1);
    await expect.poll(() => inViewport(page, "match-Q14")).toBe(true); // scrolled to it on load

    // a played match: both scores, the winner marked, and a link to Match Breakdown
    const q3 = page.getByTestId("match-Q3");
    await expect(q3).toHaveAttribute("data-status", "completed");
    await expect(q3.getByTestId("red-score")).toHaveText("83");
    await expect(q3.getByTestId("blue-score")).toHaveText("73");
    await expect(q3.getByLabel("Winner")).toHaveCount(1);
    await expect(q3.getByTestId("match-breakdown-link")).toHaveAttribute("href", "/analytics/match-breakdown?event=USWABON1&match=Q3");
    // an unplayed match has no score and no breakdown link
    await expect(page.getByTestId("match-Q20").getByTestId("red-score")).toHaveCount(0);
    await expect(page.getByTestId("match-Q20").getByTestId("match-breakdown-link")).toHaveCount(0);
    // the time is the event's own (Q1 at 09:00 in Los Angeles)
    await expect(page.getByTestId("match-Q1")).toContainText(/9:00\s?AM/);
  });

  test("highlights our teams (any of the account's FTC teams) and nothing else", async ({ page }) => {
    await open(page, "?events=1");
    for (const label of ["Q5", "Q13", "Q30"]) {
      await expect(page.getByTestId(`match-${label}`)).toHaveAttribute("data-ours", "true");
      await expect(page.getByTestId(`match-${label}`).locator("[data-ours='true']").first()).toContainText("3468");
    }
    await expect(page.getByTestId("match-Q6")).not.toHaveAttribute("data-ours", "true");
    await expect(page.locator("li[data-ours='true']")).toHaveCount(3);
  });

  test("tabs: Practice, Qualifications, Playoffs with SF / F labels", async ({ page }) => {
    await open(page, "?events=1");
    await page.getByTestId("tab-practice").click();
    expect(await labels(page)).toEqual(["P1", "P2"]);
    await page.getByTestId("tab-playoff").click();
    expect(await labels(page)).toEqual(["SF1", "SF2", "F3"]);
    await expect(page.getByTestId("tab-playoff")).toContainText("3");
  });

  test("Our matches and the team-number search", async ({ page }) => {
    await open(page, "?events=1");
    await page.getByRole("tab", { name: "Our matches" }).click();
    expect(await labels(page)).toEqual(["Q5", "Q13", "Q30"]);
    await page.getByRole("tab", { name: "All matches" }).click();
    expect(await labels(page)).toHaveLength(40);

    await page.getByTestId("match-search").fill("3468");
    expect(await labels(page)).toEqual(["Q5", "Q13", "Q30"]);
    await page.getByTestId("match-search").fill("#110"); // team 110 is in Q9 (red), Q10 and Q8 / Q7 (blue)
    expect((await labels(page)).length).toBeGreaterThan(0);
    await page.getByTestId("match-search").fill("99999");
    await expect(page.getByTestId("match-group-empty")).toContainText("No matches fit those filters");
    await page.getByRole("button", { name: "Clear filters" }).click();
    expect(await labels(page)).toHaveLength(40);
  });

  test("a manual refresh asks again and updates the last-updated time", async ({ page }) => {
    await open(page, "?events=1");
    await expect(page.getByTestId("last-updated")).toContainText(/Updated\s+10:58/);
    await page.getByTestId("refresh-matches").click();
    await expect(page.getByTestId("refresh-matches")).toBeDisabled();
    await expect(page.getByTestId("last-updated")).toContainText(/Updated\s+11:01/);
    expect(await page.evaluate(() => window.__refreshes)).toBe(1);
  });

  test("shows the last schedule with a notice when the latest fetch failed", async ({ page }) => {
    await open(page, "?events=1&state=error");
    await expect(page.getByTestId("match-list-error")).toContainText("Couldn't reach the FIRST schedule");
  });
});

test.describe("several events", () => {
  test("an event switcher (All events first, then each event in order) and per-event groups", async ({ page }) => {
    await open(page);
    const tabs = page.getByTestId("event-switcher").getByRole("tab");
    expect(await tabs.allTextContents()).toEqual(["All events", "Bonney Lake Qualifier", "Sequim League Meet"]);
    // all events: one group per event, each with its own next match
    await expect(page.getByTestId("match-group-USWABON1")).toBeVisible();
    await expect(page.getByTestId("match-group-USWASEQ")).toBeVisible();
    await expect(page.locator("[data-next='true']")).toHaveCount(2);

    await page.getByTestId("event-tab-USWASEQ").click();
    await expect(page.getByTestId("match-group-USWABON1")).toHaveCount(0);
    expect((await labels(page, "USWASEQ")).length).toBe(40);
    // Sequim has none of our teams: no highlights there
    await expect(page.locator("li[data-ours='true']")).toHaveCount(0);

    await page.getByTestId("event-tab-USWABON1").click();
    await expect(page.getByTestId("match-group-USWASEQ")).toHaveCount(0);
    await expect(page.locator("li[data-ours='true']")).toHaveCount(3);
  });
});

test.describe("loading, empty and phones", () => {
  test("shows card-sized skeletons while the schedule loads, with no layout shift when it arrives", async ({ page }) => {
    await open(page, "?events=1&state=loading");
    const skeleton = page.getByTestId("match-list-skeleton");
    await expect(skeleton).toBeVisible();
    const skeletonCard = (await skeleton.locator("> div").first().boundingBox())!;
    const docTop = () => page.getByTestId("match-list").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const topBefore = await docTop();

    await open(page, "?events=1");
    await expect(page.getByTestId("match-Q1")).toBeAttached();
    const card = { height: await page.getByTestId("match-Q1").evaluate((el) => el.getBoundingClientRect().height) };
    const topAfter = await docTop(); // document position: the page scrolls itself to the next match
    expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(1); // the list starts in the same place
    expect(card.height).toBeGreaterThanOrEqual(skeletonCard.height - 1); // a card is at least as tall as its skeleton
  });

  test("no active events: an empty state, no refresh button", async ({ page }) => {
    await open(page, "?events=0");
    await expect(page.getByTestId("match-list-empty")).toContainText("No active events yet");
    await expect(page.getByTestId("refresh-matches")).toHaveCount(0);
  });

  test("a clean card layout on a phone (no sideways scrolling, controls reachable)", async ({ page }) => {
    await open(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole("tab", { name: "Our matches" }).click();
    await expectNoHorizontalScroll(page);
    await expect(page.getByTestId("match-Q13")).toBeVisible();
  });
});

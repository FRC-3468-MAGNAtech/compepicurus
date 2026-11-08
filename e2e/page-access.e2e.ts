import { expect, test, type Page } from "@playwright/test";

// P26: Admin Panel > Page Access and the no-access screen in a real browser, on /e2e/page-access (the real components on in-memory data). What the database
// lets each person write is proved by the emulator rules tests; who can open what is proved by lib/page-access/access.test.ts. This checks the screens.

async function open(page: Page, query = "") {
  await page.goto(`/e2e/page-access${query}`);
  await page.waitForFunction(() => Array.isArray(window.__pa));
}
const log = (page: Page) => page.evaluate(() => window.__pa ?? []);
async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

declare global {
  interface Window {
    __pa?: { type: string; [key: string]: unknown }[];
  }
}

test.describe("the role matrix", () => {
  test("rows are the restricted pages, columns the roles, ticked from the defaults", async ({ page }) => {
    await open(page, "?tab=roles");
    const matrix = page.getByTestId("role-matrix");
    await expect(matrix.locator("tbody tr")).toHaveCount(11);
    await expect(matrix.locator("thead th")).toHaveCount(10); // the page column + 9 roles
    for (const [role, pageId] of [
      ["lead-scout", "assignments"],
      ["lead-scout", "lead-scout-form"],
      ["team-coach", "team-management"],
      ["pit-team", "helper-form"],
      ["pit-scout", "helper-form"],
      ["lead-strategist", "match-strategy-form"],
      ["drive-team", "drive-reflection-form"],
    ]) {
      await expect(page.getByTestId(`matrix-${role}-${pageId}`)).toHaveAttribute("data-state", "checked");
    }
    await expect(page.getByTestId("matrix-media-assignments")).toHaveAttribute("data-state", "unchecked");
    await expect(page.getByTestId("matrix-match-scout-team-management")).toHaveAttribute("data-state", "unchecked");
  });

  test("ticking and unticking saves, and the matrix follows", async ({ page }) => {
    await open(page, "?tab=roles");
    await page.getByTestId("matrix-media-assignments").click();
    await expect(page.getByTestId("matrix-media-assignments")).toHaveAttribute("data-state", "checked");
    await page.getByTestId("matrix-lead-scout-assignments").click();
    await expect(page.getByTestId("matrix-lead-scout-assignments")).toHaveAttribute("data-state", "unchecked");
    expect(await log(page)).toEqual([
      { type: "role", role: "media", pageId: "assignments", on: true },
      { type: "role", role: "lead-scout", pageId: "assignments", on: false },
    ]);
  });

  test("the page column stays put while the table scrolls sideways, and the page itself doesn't", async ({ page }) => {
    await open(page, "?tab=roles");
    const first = page.getByTestId("role-matrix").locator("tbody tr").first().locator("th");
    await expect(first).toHaveCSS("position", "sticky");
    const scroller = page.getByTestId("role-matrix");
    const before = (await first.boundingBox())!;
    await scroller.evaluate((el) => (el.scrollLeft = 300));
    const after = (await first.boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    await expectNoHorizontalScroll(page);
    // its backing is solid (opaque), so scrolled cells never show through
    const alpha = await first.evaluate((el) => {
      const c = getComputedStyle(el).backgroundColor;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const parts = m[1].split(/[,/ ]+/).filter(Boolean);
      return parts.length > 3 ? Number(parts[3]) : 1;
    });
    expect(alpha).toBeGreaterThanOrEqual(0.9);
  });
});

test.describe("member overrides, effective access and preview", () => {
  test("pick a member: where each page's access comes from, and grant / deny / follow roles", async ({ page }) => {
    await open(page, "?tab=members");
    await page.getByTestId("pa-member-select").click();
    await page.getByRole("option", { name: /Lee Lead/ }).click();
    const row = (id: string) => page.getByTestId("member-access-editor").locator(`li[data-page='${id}']`);

    await expect(row("assignments")).toHaveAttribute("data-allowed", "true");
    await expect(row("assignments").getByTestId("access-source")).toHaveText("Role: Lead Scout");
    await expect(row("team-management")).toHaveAttribute("data-allowed", "false");
    await expect(row("team-management").getByTestId("access-source")).toHaveText("No role or grant opens it");

    await page.getByTestId("override-team-management-grant").click();
    await expect(row("team-management")).toHaveAttribute("data-allowed", "true");
    await expect(row("team-management").getByTestId("access-source")).toHaveText("Extra page granted to this member");

    await page.getByTestId("override-assignments-deny").click();
    await expect(row("assignments")).toHaveAttribute("data-allowed", "false");
    await expect(row("assignments").getByTestId("access-source")).toContainText("Closed by an override");
    await expect(row("assignments").getByTestId("access-source")).toContainText("Lead Scout");

    await page.getByTestId("override-assignments-default").click();
    await expect(row("assignments")).toHaveAttribute("data-allowed", "true");
    expect(await log(page)).toEqual([
      { type: "member", uid: "lee", pageId: "team-management", state: "grant" },
      { type: "member", uid: "lee", pageId: "assignments", state: "deny" },
      { type: "member", uid: "lee", pageId: "assignments", state: "default" },
    ]);
  });

  test("a secondary role counts (Sam's Pit Team role opens the Helper Form)", async ({ page }) => {
    await open(page, "?tab=members&member=sam");
    const row = page.getByTestId("member-access-editor").locator("li[data-page='helper-form']");
    await expect(row).toHaveAttribute("data-allowed", "true");
    await expect(row.getByTestId("access-source")).toHaveText("Role: Pit Team");
  });

  test("Preview as member shows their navigation and pages, and follows the overrides", async ({ page }) => {
    await open(page, "?tab=members&member=mia");
    const nav = page.getByTestId("preview-nav");
    const pages = page.getByTestId("preview-pages");
    // Mia (Media): open pages only
    for (const label of ["Dashboard", "Match List", "Match Scout Form", "Analytics", "People", "Credits"]) await expect(nav).toContainText(label);
    for (const label of ["Assignments", "Team Management", "Scout Accuracy", "Active Events", "Admin Panel"]) await expect(nav).not.toContainText(label);
    await expect(pages.locator("li[data-page='assignments']")).toHaveAttribute("data-open", "false");
    await expect(pages.locator("li[data-page='match-list']")).toHaveAttribute("data-open", "true");
    await expect(pages.locator("li[data-page='admin-panel']")).toHaveAttribute("data-open", "false");

    await page.getByTestId("override-assignments-grant").click();
    await expect(nav).toContainText("Assignments");
    await expect(pages.locator("li[data-page='assignments']")).toHaveAttribute("data-open", "true");
  });

  test("an admin or the owner shows a note instead of overrides", async ({ page }) => {
    await open(page, "?tab=members&member=ada");
    await expect(page.getByTestId("member-admin-note")).toContainText("can always open every page");
    await expect(page.getByTestId("member-access-editor")).toHaveCount(0);
    await expect(page.getByTestId("preview-as-member")).toHaveCount(0);
  });
});

test.describe("access requests", () => {
  test("pending requests show a count, and Approve adds the grant (Deny only declines)", async ({ page }) => {
    await open(page, "?tab=requests");
    await expect(page.getByTestId("pending-count")).toHaveText("2");
    await expect(page.getByTestId("request-mia_assignments")).toContainText("Mia Media asked for Assignments");

    await page.getByTestId("approve-mia_assignments").click();
    await expect(page.getByTestId("request-mia_assignments")).toHaveCount(0);
    await expect(page.getByTestId("decided-mia_assignments")).toContainText("Approved");
    await page.getByTestId("deny-sam_team-management").click();
    await expect(page.getByTestId("decided-sam_team-management")).toContainText("Denied");
    await expect(page.getByTestId("no-pending-requests")).toBeVisible();
    await expect(page.getByTestId("pending-count")).toHaveCount(0);
    expect(await log(page)).toEqual([
      { type: "decide", id: "mia_assignments", approve: true },
      { type: "decide", id: "sam_team-management", approve: false },
    ]);

    // the approval is a grant: Mia now has Assignments, Sam still hasn't Team Management
    await page.getByTestId("pa-tab-members").click();
    await page.getByTestId("pa-member-select").click();
    await page.getByRole("option", { name: /Mia Media/ }).click();
    await expect(page.getByTestId("member-access-editor").locator("li[data-page='assignments'] [data-testid='access-source']")).toHaveText("Extra page granted to this member");
  });

  test("nothing waiting is said plainly", async ({ page }) => {
    await open(page, "?tab=requests&requests=none");
    await expect(page.getByTestId("no-pending-requests")).toContainText("No one is waiting for access");
  });
});

test.describe("the no-access screen", () => {
  test("says what's happening, offers Request access, and then shows the request was sent", async ({ page }) => {
    await open(page, "?view=no-access");
    await expect(page.getByRole("heading")).toHaveText("You don't have access to Assignments");
    await expect(page.getByTestId("request-access")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/dashboard");
    await page.getByTestId("request-access").click();
    await expect(page.getByTestId("request-pending")).toContainText("Request sent");
    await expect(page.getByTestId("request-access")).toHaveCount(0); // no second request while one is pending
    expect(await log(page)).toEqual([{ type: "request", pageId: "assignments" }]);
    await expectNoHorizontalScroll(page);
  });

  test("a failed request says so and can be retried", async ({ page }) => {
    await open(page, "?view=no-access&fail=1");
    await page.getByTestId("request-access").click();
    await expect(page.getByTestId("request-error")).toContainText("Couldn't send that request");
    await expect(page.getByTestId("request-access")).toBeEnabled();
  });

  test("after a denial you can ask again; after an approval you're told to reload", async ({ page }) => {
    await open(page, "?view=no-access&status=denied");
    await expect(page.getByTestId("request-denied")).toContainText("You can ask again");
    await expect(page.getByTestId("request-access")).toBeVisible();
    await open(page, "?view=no-access&status=approved");
    await expect(page.getByTestId("request-approved")).toContainText("approved");
    await expect(page.getByTestId("request-access")).toHaveCount(0);
  });

  test("an admin-only page offers no request", async ({ page }) => {
    await open(page, "?view=no-access&admin-only=1");
    await expect(page.getByTestId("no-access")).toContainText("only for admins");
    await expect(page.getByTestId("request-access")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test("every tab fits the screen", async ({ page }) => {
    for (const q of ["?tab=roles", "?tab=members&member=lee", "?tab=requests", "?view=no-access"]) {
      await open(page, q);
      await expectNoHorizontalScroll(page);
    }
  });
});

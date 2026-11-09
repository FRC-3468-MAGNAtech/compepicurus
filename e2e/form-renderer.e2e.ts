import { expect, test, type Page } from "@playwright/test";

// P27: the generic FormRenderer on /e2e/form-renderer: slider, step sequence, checkbox grid, photos (a fake uploader), per-team boxes for 2 and 3 team alliances with a
// team picker in each, and plan versus actual. (The rules of each are proved by lib/forms/p27.test.ts; this is the real controls in a browser.)

async function open(page: Page, query = "") {
  await page.goto(`/e2e/form-renderer${query}`);
  await expect(page.getByTestId("form-renderer")).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __fr?: unknown }).__fr);
  await page.waitForTimeout(400); // the form's own effects (team boxes filling from the schedule) have run
}
type FrState = { values: Record<string, unknown>; entry: Record<string, unknown>; plan: { differences: number; linkedEntryId: string | null } | null; pending: Record<string, string[]>; errors: Record<string, string> };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __fr: FrState }).__fr);

// a 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test.describe("slider", () => {
  test("moves along its range, shows ticks and end labels, and stores a whole number", async ({ page }) => {
    await open(page);
    const slider = page.locator('input[type="range"]');
    await expect(slider).toHaveAttribute("min", "1");
    await expect(slider).toHaveAttribute("max", "5");
    await expect(page.getByText("Weak")).toBeVisible();
    await expect(page.getByText("Strong")).toBeVisible();
    await slider.fill("4");
    await expect(page.getByTestId("slider-value")).toHaveText("4");
    expect((await state(page)).values.skill).toBe(4);
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    expect((await state(page)).values.skill).toBe(5);
  });
});

test.describe("step sequence", () => {
  test("tap to add, once-only steps can't repeat, pinned steps stay at the ends, middle steps move and every step can be removed", async ({ page }) => {
    await open(page);
    const field = page.getByTestId("sequence-field");
    await field.getByTestId("seq-add-hive").click();
    await field.getByTestId("seq-add-park").click();
    await field.getByTestId("seq-add-start").click(); // pinned first, added last
    await field.getByTestId("seq-add-flower").click();
    await expect(field.getByTestId("seq-summary")).toHaveText("Start → Hive → Flower → Park");
    expect((await state(page)).values.cycle).toEqual(["start", "hive", "flower", "park"]);
    await expect(field.getByTestId("seq-add-start")).toBeDisabled();
    await expect(field.getByTestId("seq-add-park")).toBeDisabled();
    await field.getByTestId("seq-add-hive").click(); // unlimited
    await expect(field.getByTestId("seq-summary")).toHaveText("Start → Hive → Flower → Hive → Park");

    // pinned chips have no move buttons; the middle ones do
    await expect(field.getByTestId("seq-chip-0").getByRole("button", { name: /earlier/ })).toHaveCount(0);
    await expect(field.getByTestId("seq-chip-4").getByRole("button", { name: /later/ })).toHaveCount(0);
    await field.getByRole("button", { name: "Move Flower (step 3) earlier" }).click();
    await expect(field.getByTestId("seq-summary")).toHaveText("Start → Flower → Hive → Hive → Park");
    await field.getByRole("button", { name: "Remove Park (step 5)" }).click();
    await expect(field.getByTestId("seq-summary")).toHaveText("Start → Flower → Hive → Hive");
    await expect(field.getByTestId("seq-add-park")).toBeEnabled(); // removed once-only steps can be added again
  });

  test("a middle step can be dragged", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "mouse drag: touch uses the arrows");
    await open(page);
    const field = page.getByTestId("sequence-field");
    for (const id of ["hive", "flower", "bonus"]) await field.getByTestId(`seq-add-${id}`).click();
    const grip = field.getByRole("button", { name: /Drag Bonus/ });
    const target = field.getByTestId("seq-chip-0");
    const g = (await grip.boundingBox())!;
    const t = (await target.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 - 8, g.y + g.height / 2 + 4, { steps: 4 });
    await page.mouse.move(t.x + 10, t.y + t.height / 2, { steps: 14 });
    await page.mouse.up();
    await expect.poll(async () => ((await state(page)).values.cycle as string[]).join(",")).toBe("bonus,hive,flower");
  });
});

test.describe("checkbox grid", () => {
  test("one yes/no per cell, with the disabled cell not offered", async ({ page }) => {
    await open(page);
    const grid = page.getByTestId("matrix-field");
    await expect(grid.locator("td[data-cell='leave_end']")).toHaveAttribute("data-disabled", "true");
    await expect(grid.getByRole("checkbox", { name: "Leave, Endgame" })).toHaveCount(0);
    await grid.getByRole("checkbox", { name: "Leave, Auto" }).click();
    await grid.getByRole("checkbox", { name: "Park, Endgame" }).click();
    await expect(grid.getByRole("checkbox", { name: "Leave, Auto" })).toHaveAttribute("aria-checked", "true");
    expect((await state(page)).values.moves).toEqual({ leave_auto: true, park_auto: false, park_end: true });
    await grid.getByRole("checkbox", { name: "Leave, Auto" }).click();
    expect(((await state(page)).values.moves as Record<string, boolean>).leave_auto).toBe(false);
  });
});

test.describe("per-team boxes", () => {
  test("a 2-team alliance draws 2 boxes filled from the schedule; a 3-team alliance draws 3", async ({ page }) => {
    await open(page, "?alliance=2");
    await expect(page.getByTestId("team-box-1")).toContainText("Red 1 · 3468");
    await expect(page.getByTestId("team-box-2")).toContainText("Red 2 · 111");
    await expect(page.getByTestId("team-box-3")).toHaveCount(0);
    expect((await state(page)).values).toMatchObject({ t1_team: 3468, t2_team: 111 });

    await open(page, "?alliance=3");
    await expect(page.getByTestId("team-box-3")).toContainText("Red 3 · 222");
    expect((await state(page)).values).toMatchObject({ t1_team: 3468, t2_team: 111, t3_team: 222 });
  });

  test("the team in a box can be corrected with the searchable picker, and the schedule doesn't overwrite it", async ({ page }) => {
    await open(page);
    await page.getByTestId("team-box-2").getByTestId("team-select").click();
    await page.getByTestId("team-search").fill("444");
    await expect(page.getByTestId("team-options").locator("button")).toHaveCount(1);
    await page.locator("[data-team='444']").click();
    await expect(page.getByTestId("team-box-2")).toContainText("Red 2 · 444");
    expect((await state(page)).values.t2_team).toBe(444);
    // searching by name works too
    await page.getByTestId("team-box-1").getByTestId("team-select").click();
    await page.getByTestId("team-search").fill("team 22");
    await expect(page.locator("[data-team='222']")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("with no alliance chosen yet it says so and draws the default two boxes", async ({ page }) => {
    await open(page, "?alliance-chosen=0");
    await expect(page.getByTestId("repeat-" + (await page.locator("[data-testid^='repeat-']").first().getAttribute("data-testid"))!.replace("repeat-", ""))).toContainText("Choose an alliance to see its teams.");
    await expect(page.locator("[data-testid^='team-box-']")).toHaveCount(2);
  });

  test("a required field is checked for the boxes shown, per team", async ({ page }) => {
    await open(page, "?alliance=2");
    await page.getByTestId("validate").click();
    const { errors } = await state(page);
    expect(Object.keys(errors).sort()).toEqual(["t1_notes", "t2_notes"]);
    expect(errors.t1_notes).toBe("Notes (team 1) is required.");
    await expect(page.getByTestId("team-box-1")).toContainText("Notes (team 1) is required.");
  });
});

test.describe("plan versus actual", () => {
  test("prefills from the plan, marks every difference with 'Planned: Hive', and keeps the person's own edits when the plan changes", async ({ page }) => {
    await open(page, "?plan=1");
    expect((await state(page)).values).toMatchObject({ t1_role: "hive", t1_auto: true, t2_role: "flower", t2_auto: false });
    await expect(page.getByTestId("plan-summary")).toHaveText("Matches the plan");
    expect((await state(page)).plan).toEqual({ differences: 0, linkedEntryId: "plan-1" });

    // change team 2's role and team 1's "scores in auto": two differences
    await page.getByTestId("team-box-2").getByRole("combobox").click();
    await page.getByRole("option", { name: "Hive" }).click();
    await page.getByTestId("team-box-1").getByRole("checkbox", { name: "Scores in auto" }).click();
    await expect(page.getByTestId("plan-summary")).toHaveText("2 differences from plan");
    await expect(page.getByTestId("plan-diff")).toHaveCount(2);
    await expect.poll(async () => (await state(page)).plan?.differences).toBe(2);
    const icon = page.getByTestId("team-box-2").getByTestId("plan-diff");
    await icon.click(); // a tap opens the tooltip
    await expect(page.getByText("Planned: Flower")).toBeVisible();

    // the plan changes while the form is open: team 1's role (untouched) follows it, team 2's edited answer stays
    await page.getByTestId("change-plan").click();
    await expect.poll(async () => (await state(page)).values.t1_role).toBe("flower");
    expect((await state(page)).values.t2_role).toBe("hive");
  });

  test("with no plan it says so and starts empty", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("plan-summary")).toContainText("No plan was found");
    expect((await state(page)).values.t1_role).toBe("");
    await expect(page.getByTestId("plan-diff")).toHaveCount(0);
  });
});

test.describe("photos", () => {
  test("a photo is shrunk, queued, shown as uploading, then becomes part of the answer; the limit is enforced", async ({ page }) => {
    await open(page);
    const field = page.getByTestId("photo-field-photos");
    await expect(field).toContainText("0 of 2 photos");
    await field.getByTestId("photo-input").setInputFiles({ name: "robot.png", mimeType: "image/png", buffer: PNG });
    await expect(field.getByTestId("photo-pending")).toBeVisible();
    await expect(field.getByTestId("photo-thumb")).toHaveCount(1, { timeout: 15000 });
    await expect(field.getByTestId("photo-pending")).toHaveCount(0);
    const photos = (await state(page)).values.photos as { url: string; contentType: string }[];
    expect(photos).toHaveLength(1);
    expect(photos[0].url).toMatch(/^https:\/\/fixture\.public\.blob\.vercel-storage\.com\/.+\.jpg$/);
    await expect(field).toContainText("1 of 2 photos");

    await field.getByTestId("photo-input").setInputFiles({ name: "two.png", mimeType: "image/png", buffer: PNG });
    await expect(field.getByTestId("photo-thumb")).toHaveCount(2, { timeout: 15000 });
    await expect(field.getByTestId("photo-add")).toHaveCount(0); // full

    await field.getByRole("button", { name: "Remove this photo" }).first().click();
    await expect(field.getByTestId("photo-thumb")).toHaveCount(1);
    await expect(field.getByTestId("photo-add")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test("nothing sticks out sideways", async ({ page }) => {
    await open(page, "?alliance=3&plan=1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});

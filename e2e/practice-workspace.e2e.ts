import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// P24: the practice ScoutingWorkspace in a real browser, on the fixture page (/e2e/practice-workspace): the real workspace, ScoutForm and placeholder video in the same
// two-robot flow and action bar as the practice screens, with no login. Screenshots go to e2e/screenshots/ (not committed).

const SHOTS = "e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function open(page: Page, query = "") {
  await page.goto(`/e2e/practice-workspace${query}`);
  await expect(page.getByTestId("scouting-workspace")).toBeVisible();
  await page.waitForFunction(() => Array.isArray(window.__submitted)); // hydrated
  if (query.includes("novideo")) return;
  await page.getByTestId("workspace-video-box").waitFor();
  await expect.poll(async () => (await page.getByTestId("workspace-video-box").boundingBox())?.width ?? 0).toBeGreaterThan(100);
}

/** The page itself must not scroll: the wheel does nothing, and anything that nudges it is put back. */
async function expectPageLocked(page: Page) {
  await page.mouse.move(40, 40);
  await page.mouse.wheel(0, 800).catch(() => {}); // (mobile WebKit has no wheel)
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;
const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const submitted = (page: Page) => page.evaluate(() => window.__submitted ?? []);

test.describe("layout (tablet and desktop)", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!!isMobile, "desktop and tablet layout");
  });

  test("the video is 16:9, centered in its pane and as large as fits; the page doesn't scroll; the form scrolls inside its panel and the action bar stays pinned", async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);

    const pane = await box(page, "workspace-video-pane");
    const video = await box(page, "workspace-video-box");
    expect(Math.abs(video.width / video.height - 16 / 9)).toBeLessThan(0.03);
    // centered both ways
    expect(Math.abs(center(video).x - center(pane).x)).toBeLessThan(2);
    expect(Math.abs(center(video).y - center(pane).y)).toBeLessThan(2);
    // as large as fits: it touches the pane's width or height
    expect(video.width >= pane.width - 2 || video.height >= pane.height - 2).toBe(true);
    expect(video.width).toBeGreaterThan(pane.width * 0.9);
    expect(video.width).toBeGreaterThan(500);

    // the page itself doesn't scroll
    await expectPageLocked(page);
    const ws = await box(page, "scouting-workspace");
    expect(ws.y + ws.height).toBeLessThanOrEqual(900 + 1);

    // the form scrolls inside its own panel; the action bar doesn't move
    const scroll = page.getByTestId("workspace-form-scroll");
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const barBefore = await box(page, "workspace-actions");
    const videoBefore = await box(page, "workspace-video-box");
    await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    const barAfter = await box(page, "workspace-actions");
    const videoAfter = await box(page, "workspace-video-box");
    expect(barAfter.y).toBe(barBefore.y);
    expect(videoAfter.y).toBe(videoBefore.y); // the video never leaves
    expect(barAfter.y + barAfter.height).toBeLessThanOrEqual(900);
    await expect(page.getByTestId("next-robot")).toBeInViewport();
    await expect(page.getByTestId("workspace-video-box")).toBeInViewport();
    // the score bar sticks inside the form panel, above the action bar
    const score = page.getByText("Total", { exact: true }).first();
    const sb = (await score.boundingBox())!;
    expect(sb.y + sb.height).toBeLessThanOrEqual(barAfter.y + 1);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-desktop-1440.png` });
  });

  test("works the same at tablet size", async ({ page }, info) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await open(page);
    expect(await page.getByTestId("scouting-workspace").getAttribute("data-layout")).toBe("wide");
    const video = await box(page, "workspace-video-box");
    expect(Math.abs(video.width / video.height - 16 / 9)).toBeLessThan(0.03);
    await expectPageLocked(page);
    const form = await box(page, "workspace-form-column");
    expect(form.width).toBeGreaterThanOrEqual(319);
    await expect(page.getByTestId("next-robot")).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-tablet-820.png` });
  });

  test("the divider resizes the form within 320px and 60%, double-click resets it, the keyboard works, and the width survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const row = await box(page, "scouting-workspace");
    const divider = page.getByTestId("workspace-divider");
    await expect(divider).toHaveAttribute("role", "separator");
    await expect(divider).toHaveAttribute("aria-orientation", "vertical");
    const widthOf = async () => Math.round((await box(page, "workspace-form-column")).width);
    /** A resize has landed when the width stops changing (WebKit reports the layout a frame or two late). */
    const settle = async () => {
      let last = -1;
      await expect.poll(async () => { const w = await widthOf(); const same = w === last; last = w; await page.waitForTimeout(80); return same; }).toBe(true);
    };

    const start = await widthOf();
    expect(Math.abs(start - Math.round(row.width * 0.38))).toBeLessThanOrEqual(2);
    const videoStart = await box(page, "workspace-video-box");

    // drag the divider left by 150px: the form grows by about that, and the video shrinks
    const d = center((await divider.boundingBox())!);
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    await page.mouse.move(d.x - 80, d.y, { steps: 6 });
    await page.mouse.move(d.x - 150, d.y, { steps: 6 });
    await page.mouse.up();
    await settle();
    const wider = await widthOf();
    expect(wider - start).toBeGreaterThan(130);
    expect(wider - start).toBeLessThan(170);
    expect((await box(page, "workspace-video-box")).width).toBeLessThan(videoStart.width);

    // limits: far right gives the minimum (320), far left the maximum (60%)
    for (const [targetX, expected] of [[row.x + row.width - 80, 320], [row.x + 40, Math.floor(row.width * 0.6)]] as const) {
      await settle();
      await page.waitForTimeout(200);
      const c = center((await divider.boundingBox())!);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(targetX, c.y, { steps: 14 });
      await page.mouse.up();
      await expect.poll(async () => Math.abs((await widthOf()) - expected), { timeout: 4000 }).toBeLessThanOrEqual(2);
    }

    // double-click resets
    await divider.dblclick();
    expect(Math.abs((await widthOf()) - Math.round(row.width * 0.38))).toBeLessThanOrEqual(2);

    // keyboard: focus the divider; left grows, right shrinks, Shift is bigger, Home/End jump
    await divider.focus();
    const base = await widthOf();
    await page.keyboard.press("ArrowLeft");
    expect((await widthOf()) - base).toBe(16);
    await page.keyboard.press("Shift+ArrowRight");
    expect((await widthOf()) - base).toBe(16 - 64);
    await page.keyboard.press("Home");
    expect(await widthOf()).toBe(320);
    await page.keyboard.press("End");
    expect(Math.abs((await widthOf()) - Math.floor(row.width * 0.6))).toBeLessThanOrEqual(1);
    await expect(divider).toHaveAttribute("aria-valuenow", String(await widthOf()));

    // remembered after a reload
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft"); // 352
    const saved = await widthOf();
    await page.waitForTimeout(700);
    await page.reload();
    await open(page);
    expect(Math.abs((await widthOf()) - saved)).toBeLessThanOrEqual(2);
  });

  test("Focus mode collapses the form to a strip and gives the video the room, keeps what was entered, and F toggles it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const before = await box(page, "workspace-video-box");
    await page.getByRole("switch", { name: /Leave/i }).first().click();
    await page.getByTestId("workspace-focus").click();
    await expect(page.getByTestId("workspace-form-strip")).toBeVisible();
    await expect(page.getByTestId("workspace-form-column")).toBeHidden();
    await expect.poll(async () => (await box(page, "workspace-video-box")).width).toBeGreaterThan(before.width + 100);
    // F brings the form back, with the toggle still on
    await page.keyboard.press("f");
    await expect(page.getByTestId("workspace-form-column")).toBeVisible();
    await expect(page.getByRole("switch", { name: /Leave/i }).first()).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("f");
    await expect(page.getByTestId("workspace-form-strip")).toBeVisible();
    await page.getByTestId("workspace-form-strip").click();
    await expect(page.getByTestId("workspace-form-column")).toBeVisible();
  });

  test("fullscreen takes the whole workspace (video and form), where the browser allows it", async ({ page }) => {
    await open(page);
    test.skip(!(await page.evaluate(() => document.fullscreenEnabled)), "this browser doesn't allow fullscreen");
    await page.getByTestId("workspace-fullscreen").click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid"))).toBe("scouting-workspace");
    await expect(page.getByTestId("workspace-video-box")).toBeVisible();
    await expect(page.getByTestId("workspace-form-panel")).toBeVisible();
    await page.getByTestId("workspace-fullscreen").click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  });
});

test.describe("comments drawer", () => {
  test("opens any time, is per robot, writes into the submitted entry, and never pauses the video or covers its controls", async ({ page, isMobile }, info) => {
    await open(page);
    await expect(page.getByTestId("comments-dot")).toHaveCount(0);
    // the video is playing before the drawer opens (trial has a play/pause button)
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

    await page.getByTestId("comments-tab").click();
    const drawer = page.getByTestId("comments-drawer");
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId("comments-robot")).toHaveText("Robot 1: #1234");
    await expect(page.getByTestId("comments-input")).toBeFocused();
    await page.getByTestId("comments-input").fill("Strong auto, tipped once");
    await expect(page.getByTestId("comments-dot")).toBeVisible();
    // still playing: opening and typing never paused it
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    // the drawer doesn't overlap the video's own controls
    if (!isMobile) {
      // (the drawer slides open and the video re-fits beside it: wait for it to settle)
      await expect
        .poll(async () => {
          const d = await drawer.boundingBox();
          const v = await box(page, "workspace-video-box");
          return d!.x - (v.x + v.width);
        })
        .toBeGreaterThanOrEqual(-1);
    }
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-comments-open.png` });

    // Esc closes it from inside the box; the tab or C opens it again, and "c" typed in the box is just a letter
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page.getByTestId("comments-dot")).toBeVisible(); // still has text
    await page.keyboard.press("c");
    await expect(drawer).toBeVisible();
    await page.getByTestId("comments-input").press("c");
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId("comments-input")).toHaveValue(/c/); // a typed letter, not a shortcut (where the cursor opens differs by browser)
    expect((await page.getByTestId("comments-input").inputValue()).length).toBe("Strong auto, tipped once".length + 1);
    await page.getByTestId("comments-input").fill("Strong auto, tipped once");
    await page.keyboard.press("Escape");

    // submit robot 1: the entry carries the comments
    await page.getByRole("switch", { name: /Leave/i }).first().click();
    await page.getByTestId("next-robot").click();
    await expect(page.getByTestId("robot-badge")).toContainText("Robot 2 of 2");
    expect(await submitted(page)).toEqual([{ team: 1234, comments: "Strong auto, tipped once", autoLeave: true }]);

    // robot 2 starts clean, with its own header
    await expect(page.getByTestId("comments-dot")).toHaveCount(0);
    await page.getByTestId("comments-tab").click();
    await expect(page.getByTestId("comments-robot")).toHaveText("Robot 2: #5678");
    await expect(page.getByTestId("comments-input")).toHaveValue("");
    await page.getByTestId("comments-input").fill("Died at the end");
    await page.getByTestId("next-robot").click(); // reachable while the drawer is open
    await expect(page.getByTestId("done")).toBeVisible();
    expect(await submitted(page)).toEqual([
      { team: 1234, comments: "Strong auto, tipped once", autoLeave: true },
      { team: 5678, comments: "Died at the end", autoLeave: false },
    ]);
  });

  test("the comments field is not in the form itself (popout mode)", async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-field-key="comments"]')).toHaveCount(0);
  });

  test("a closed drawer never takes focus from a counter, and scouting carries on while it is closed", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    const plus = page.getByRole("button", { name: "Increase Tip Hive" }).first();
    await plus.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(plus).toBeFocused();
    await expect(page.getByTestId("comments-drawer")).toBeHidden();
    // opening it is deliberate: C opens it and moves to its text box, and Escape closes it
    await page.keyboard.press("c");
    await expect(page.getByTestId("comments-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comments-drawer")).toBeHidden();
  });
});

test.describe("Competitive and Trial", () => {
  test("Competitive: the workspace adds no pause control, and nothing covers the video's controls in either mode", async ({ page, isMobile }) => {
    await open(page, "?mode=competitive");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await expect(pause).toBeDisabled(); // locked by the player, as before
    await expect(page.getByRole("button", { name: /pause/i })).toHaveCount(1);
    await expect(page.getByText("Pause is locked for this mode.")).toBeVisible();
    // comments never interrupt it
    await page.getByTestId("comments-tab").click();
    await page.getByTestId("comments-input").fill("x");
    await expect(pause).toBeDisabled();
    await expect(pause).toBeVisible();
    await page.keyboard.press("Escape");

    if (!isMobile) {
      // the player's own controls (here its play/pause button) aren't covered by the divider, the drawer or the action bar
      await page.getByTestId("comments-tab").click();
      const control = (await pause.boundingBox())!;
      for (const id of ["workspace-divider", "comments-drawer", "workspace-actions"]) {
        const other = (await box(page, id));
        const overlap = control.x < other.x + other.width && control.x + control.width > other.x && control.y < other.y + other.height && control.y + control.height > other.y;
        expect(overlap, id).toBe(false);
      }
    }
  });

  test("Trial keeps the normal play and pause", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await expect(pause).toBeEnabled();
    await pause.click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });
});

test.describe("a screen with no video", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!!isMobile, "desktop layout");
  });
  test("the form takes the workspace and still scrolls inside it with the action bar pinned", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "?novideo=1");
    await expect(page.getByTestId("workspace-form-panel")).toBeVisible();
    await expect(page.getByTestId("workspace-divider")).toHaveCount(0);
    await expect(page.getByTestId("next-robot")).toBeInViewport();
  });
});

test.describe("phone", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, "phone layout");
  });

  test("the video is pinned on top while the form scrolls below it, the action bar stays reachable, the handle resizes (and is remembered), and the video can shrink to a mini player", async ({ page }, info) => {
    await open(page);
    expect(await page.getByTestId("scouting-workspace").getAttribute("data-layout")).toBe("phone");
    const viewport = page.viewportSize()!;
    const video = await box(page, "workspace-video-box");
    expect(Math.abs(video.width / video.height - 16 / 9)).toBeLessThan(0.05);
    expect(video.width).toBeLessThanOrEqual(viewport.width);

    // the page doesn't scroll, the form does, and the video stays put
    await expectPageLocked(page);
    const scroll = page.getByTestId("workspace-form-scroll");
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const before = await box(page, "workspace-video-box");
    await scroll.evaluate((el) => (el.scrollTop = 400));
    const after = await box(page, "workspace-video-box");
    expect(after.y).toBe(before.y);
    await expect(page.getByTestId("workspace-video-box")).toBeInViewport();
    await expect(page.getByTestId("next-robot")).toBeInViewport();
    await expect(page.getByTestId("comments-tab")).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-phone.png` });

    // the handle: drag it down to give the video more room; keyboard too
    const handle = page.getByTestId("workspace-handle");
    await expect(handle).toHaveAttribute("role", "separator");
    const h0 = (await box(page, "workspace-phone-video")).height;
    const hb = center((await handle.boundingBox())!);
    await page.mouse.move(hb.x, hb.y);
    await page.mouse.down();
    await page.mouse.move(hb.x, hb.y + 60, { steps: 6 });
    await page.mouse.up();
    const h1 = (await box(page, "workspace-phone-video")).height;
    expect(h1).toBeGreaterThan(h0 + 30);
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    expect((await box(page, "workspace-phone-video")).height).toBeLessThan(h1);

    // remembered
    await page.keyboard.press("End");
    const saved = (await box(page, "workspace-phone-video")).height;
    await page.waitForTimeout(700);
    await page.reload();
    await open(page);
    expect(Math.abs((await box(page, "workspace-phone-video")).height - saved)).toBeLessThanOrEqual(3);

    // the mini player
    await page.getByTestId("workspace-mini").click();
    expect((await box(page, "workspace-phone-video")).height).toBeLessThanOrEqual(100);
    await page.getByTestId("workspace-mini").click();
    expect((await box(page, "workspace-phone-video")).height).toBeGreaterThan(150);
  });

  test("comments open as a sheet above the action bar and write into the entry", async ({ page }, info) => {
    await open(page);
    await page.getByTestId("comments-tab").click();
    const sheet = page.getByTestId("comments-sheet"); // the scrolling container (its content may be taller than the sheet)
    await expect(sheet).toBeVisible();
    // (it slides up into place: wait for it to settle) and never covers the action bar
    await expect
      .poll(async () => {
        const s = (await sheet.boundingBox())!;
        const bar = await box(page, "workspace-actions");
        return bar.y - (s.y + s.height);
      })
      .toBeGreaterThanOrEqual(-1);
    await expect(page.getByTestId("workspace-video-box")).toBeInViewport(); // the video stays visible
    await page.getByTestId("comments-input").fill("Phone comment");
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-phone-comments.png` });
    await sheet.getByRole("button", { name: "Close comments" }).click();
    await page.getByTestId("next-robot").click();
    expect((await submitted(page))[0]).toMatchObject({ team: 1234, comments: "Phone comment" });
  });
});

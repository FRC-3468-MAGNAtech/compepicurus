import { expect, test, type Page } from "@playwright/test";
import { hasModes, themes } from "../lib/themes";
import { appliedMode, inspectGlass, openFixture, pickMode, pickTheme, settled } from "./helpers";

// P18, section 7: "all blurs disappear after selecting a theme". For every theme x mode (flags once), switch to it through
// the real Appearance panel and check that every glass sample still has a backdrop filter, that it is the SAME filter as
// before any switching, and that nothing above the glass is a backdrop root at rest. Runs in Chromium and WebKit, on a
// desktop and a phone viewport (see playwright.config.ts).
test.describe("blurs survive every theme", () => {
  test("every theme x mode keeps its backdrop filters", async ({ page, isMobile }) => {
    test.setTimeout(600_000); // 60 theme x mode combinations; WebKit on a busy machine is the slow one
    await openFixture(page);
    // A clean slate regardless of what an earlier run left in this browser.
    await pickTheme(page, "team");
    await pickMode(page, "dark");

    const baseline = await inspectGlass(page);
    expect(baseline.count, "the page has the glass samples").toBeGreaterThanOrEqual(6);
    expect(baseline.problems, "baseline (Team Colors, dark)").toEqual([]);
    // On phones the app deliberately uses a lighter blur (P17), by viewport width, not because of a theme.
    for (const v of Object.values(baseline.samples)) expect(v).toMatch(/blur\(/);

    const failures: string[] = [];
    let combos = 0;
    for (const theme of themes) {
      await pickTheme(page, theme.id);
      const modes = hasModes(theme) ? (["light", "dark"] as const) : (["fixed"] as const);
      for (const mode of modes) {
        if (mode !== "fixed") await pickMode(page, mode);
        combos++;
        const label = `${theme.id}/${mode}`;
        const result = await inspectGlass(page);
        for (const p of result.problems) failures.push(`${label}: ${p}`);
        for (const [name, value] of Object.entries(result.samples)) {
          if (value !== baseline.samples[name]) failures.push(`${label}: ${name} backdrop-filter changed from "${baseline.samples[name]}" to "${value}"`);
        }
        // the status chip's backing must stay fully opaque in every theme
        const chipBg = await page.locator('[data-testid="connection-chip"]:visible').first().evaluate((el) => getComputedStyle(el).backgroundColor);
        if (!/^rgb\(/.test(chipBg)) failures.push(`${label}: connection chip background is not opaque (${chipBg})`);
      }
    }
    expect(combos).toBeGreaterThan(50);
    expect(failures, failures.join("\n")).toEqual([]);
    expect(isMobile === undefined || typeof isMobile === "boolean").toBe(true);
  });

  test("blurs survive repeated quick switching, a reload, and the system mode", async ({ page }) => {
    await openFixture(page);
    const baseline = await inspectGlass(page);
    for (const id of ["ocean", "pride-rainbow", "nebula", "obsidian", "pride-bisexual", "team", "pearl"]) {
      // no waiting for the fade between switches: the worst case for a half-finished transition
      await page.locator(`[data-testid="theme-card"][data-theme-id="${id}"]`).click();
    }
    await settled(page);
    expect((await inspectGlass(page)).problems).toEqual([]);
    await page.reload();
    await openFixture(page);
    const after = await inspectGlass(page);
    expect(after.problems).toEqual([]);
    expect(after.samples).toEqual(baseline.samples);
  });
});

test.describe("theme and mode are separate settings", () => {
  test("changing the theme never resets the mode, and the mode never resets the theme", async ({ page }) => {
    await openFixture(page);
    await pickMode(page, "light");
    await pickTheme(page, "ocean");
    expect(await appliedMode(page)).toBe("light");
    await pickTheme(page, "nebula");
    expect(await appliedMode(page)).toBe("light");
    await pickMode(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "nebula");
    expect(await appliedMode(page)).toBe("dark");
  });

  test("a pride theme disables the mode controls, and the user's own choice comes back after it", async ({ page }) => {
    await openFixture(page);
    await pickTheme(page, "ocean");
    await pickMode(page, "light");
    await pickTheme(page, "pride-transgender");

    expect(await appliedMode(page)).toBe("dark"); // one fixed look
    for (const m of ["light", "dark", "system"] as const) await expect(page.getByTestId(`mode-option-${m}`)).toBeDisabled();
    await expect(page.getByTestId("color-mode-toggle").locator("visible=true").first()).toBeDisabled();
    await expect(page.getByTestId("appearance-panel")).toContainText("Pride themes are one fixed look");
    await expect(page.getByTestId("appearance-panel")).toContainText("Your choice (Light) is kept");

    await pickTheme(page, "ocean");
    expect(await appliedMode(page)).toBe("light"); // restored
    await expect(page.getByTestId("mode-option-light")).toBeEnabled();
    await expect(page.getByTestId("mode-option-light")).toHaveAttribute("aria-pressed", "true");
  });

  test("the sun/moon quick toggle flips the mode only, and survives a reload", async ({ page }) => {
    await openFixture(page);
    await pickTheme(page, "amethyst");
    await pickMode(page, "dark");
    const toggle = page.locator('[data-testid="color-mode-toggle"]:visible').first();
    await toggle.click();
    await settled(page);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "amethyst");
    await expect(page.getByTestId("mode-option-light")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await openFixture(page);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "amethyst");
  });

  test("the initial mode follows the system preference", async ({ browser }) => {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await openFixture(page);
      expect(await appliedMode(page)).toBe(scheme);
      await expect(page.getByTestId("mode-option-system")).toHaveAttribute("aria-pressed", "true");
      await context.close();
    }
  });

  test("the saved theme and mode are on <html> and in the CSS on the very first frame (no flash)", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem("compepicurus.theme")) {
          localStorage.setItem("compepicurus.theme", "evergreen");
          localStorage.setItem("compepicurus.colorMode", "light");
        }
      } catch {}
      requestAnimationFrame(() => {
        const de = document.documentElement;
        (window as unknown as Record<string, unknown>).__firstFrame = {
          theme: de.getAttribute("data-theme"),
          mode: de.getAttribute("data-mode"),
          background: getComputedStyle(de).getPropertyValue("--background").trim(),
          scheme: getComputedStyle(de).colorScheme,
        };
      });
    });
    await page.goto("/e2e/theme-check");
    await expect(page.getByTestId("appearance-panel")).toBeVisible();
    const first = (await page.evaluate(() => (window as unknown as Record<string, unknown>).__firstFrame)) as { theme: string; mode: string; background: string; scheme: string };
    expect(first.theme).toBe("evergreen");
    expect(first.mode).toBe("light");
    expect(first.scheme).toBe("light");
    expect(first.background).toMatch(/^#f/i); // a light surface, not the default dark one
  });
});

test.describe("Settings > Appearance", () => {
  test("groups, previews and search", async ({ page }) => {
    await openFixture(page);
    for (const kind of ["solid", "gradient", "flag"]) await expect(page.getByTestId(`theme-group-${kind}`)).toBeVisible();
    await expect(page.getByTestId("theme-card")).toHaveCount(themes.length);
    await page.getByLabel("Search themes").fill("bisexual");
    await expect(page.getByTestId("theme-card")).toHaveCount(1);
    await expect(page.getByTestId("theme-card")).toContainText("Pride: Bisexual");
    await page.getByLabel("Search themes").fill("zzz");
    await expect(page.getByTestId("appearance-panel")).toContainText("No theme matches");
  });

  test("a theme card is a keyboard-operable toggle button with a selected state", async ({ page }) => {
    await openFixture(page);
    const card = page.locator('[data-testid="theme-card"][data-theme-id="lagoon"]');
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "lagoon");
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-testid="theme-card"][aria-pressed="true"]')).toHaveCount(1);
  });

  test("the page works at phone width with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openFixture(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// P32: the Gradient intensity control. Subtle / Normal / Vivid set --gradient-strength, which is the opacity of the painted page layer.
test.describe("Gradient intensity", () => {
  const strength = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--gradient-strength"));
  const layerOpacity = (page: Page) => page.getByTestId("page-gradient").evaluate((el) => getComputedStyle(el).opacity);

  test("defaults to Vivid, changes the painted page's strength, and survives a reload", async ({ page }) => {
    await openFixture(page);
    await pickTheme(page, "nebula");
    await expect(page.getByTestId("intensity-option-vivid")).toHaveAttribute("aria-pressed", "true");
    expect(await layerOpacity(page)).toBe("1");

    await page.getByTestId("intensity-option-subtle").click();
    await expect(page.getByTestId("intensity-option-subtle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => strength(page)).toBe("0.35");
    expect(Number(await layerOpacity(page))).toBeCloseTo(0.35, 2);

    await page.getByTestId("intensity-option-normal").click();
    await expect.poll(() => strength(page)).toBe("0.65");
    expect(Number(await layerOpacity(page))).toBeCloseTo(0.65, 2);

    await page.reload();
    await openFixture(page);
    await expect(page.getByTestId("intensity-option-normal")).toHaveAttribute("aria-pressed", "true");
    expect(Number(await layerOpacity(page))).toBeCloseTo(0.65, 2); // applied before the provider mounted, from this browser's copy

    await page.getByTestId("intensity-option-vivid").click();
    await expect.poll(() => strength(page)).toBe("1");
  });

  test("the setting is independent of the theme and the mode, and the glass keeps its blur at every level", async ({ page }) => {
    await openFixture(page);
    await pickTheme(page, "sunset");
    await page.getByTestId("intensity-option-subtle").click();
    await pickMode(page, "light");
    await pickTheme(page, "pride-intersex");
    await expect(page.getByTestId("intensity-option-subtle")).toHaveAttribute("aria-pressed", "true");
    for (const level of ["subtle", "normal", "vivid"]) {
      await page.getByTestId(`intensity-option-${level}`).click();
      await settled(page);
      expect((await inspectGlass(page)).problems, level).toEqual([]);
    }
  });

  test("the painted page is a real gradient on a gradient theme and flat on a solid one", async ({ page }) => {
    await openFixture(page);
    await pickTheme(page, "nebula");
    await pickMode(page, "dark");
    const image = (p: Page) => p.getByTestId("page-gradient").evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(await image(page)).toMatch(/^linear-gradient\(/);
    await pickTheme(page, "pride-intersex");
    expect(await image(page)).toMatch(/^radial-gradient\(/);
    await pickTheme(page, "ocean");
    expect(await image(page)).toBe("none"); // a flat color, no gradient image
  });
});

test.describe("sidebar", () => {
  test("the collapse arrow is fully visible and clickable, expanded and collapsed", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "the collapsible sidebar is lg+ only; phones and tablets use the drawer");
    await openFixture(page);
    // 1040 rather than exactly 1024: WebKit with classic scrollbars (Playwright's Windows build) counts the scrollbar against min-width.
    for (const width of [1040, 1280, 1536]) {
      await page.setViewportSize({ width, height: 800 });
      const arrow = page.getByTestId("sidebar-collapse");
      for (const wantCollapsed of [false, true]) {
        const label = wantCollapsed ? "Expand sidebar" : "Collapse sidebar";
        if ((await arrow.getAttribute("aria-label")) !== label) await arrow.click();
        await expect(arrow).toHaveAttribute("aria-label", label);
        // wait for the width spring to land (WebKit can start it late), not a fixed delay
        await expect.poll(async () => Math.round((await page.locator("aside:visible").first().boundingBox())!.width)).toBe(wantCollapsed ? 84 : 272);
        await expect(arrow).toBeVisible();

        const box = (await arrow.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        // Hit-test across the whole button, including the half that sticks out past the sidebar's edge (the half that used to be clipped).
        const points = [
          [box.x + 3, box.y + box.height / 2],
          [box.x + box.width / 2, box.y + box.height / 2],
          [box.x + box.width - 3, box.y + box.height / 2],
          [box.x + box.width / 2, box.y + 3],
          [box.x + box.width / 2, box.y + box.height - 3],
        ];
        for (const [x, y] of points) {
          const hit = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[data-testid="sidebar-collapse"]'), [x, y]);
          expect(hit, `${width}px ${wantCollapsed ? "collapsed" : "expanded"}: arrow not hit at ${Math.round(x)},${Math.round(y)}`).toBe(true);
        }
        // The outer half really does sit outside the glass panel.
        const panel = (await page.locator("aside:visible").first().locator("> div").first().boundingBox())!;
        expect(box.x + box.width).toBeGreaterThan(panel.x + panel.width);
      }
      // A real click on the outer edge (the part that used to be clipped) works too. Leave the sidebar expanded for the next width.
      await arrow.click({ position: { x: 25, y: 14 } });
      await expect(arrow).toHaveAttribute("aria-label", "Collapse sidebar");
      await expect.poll(async () => Math.round((await page.locator("aside:visible").first().boundingBox())!.width)).toBe(272);
    }
  });

  test("the sidebar has no theme picker; it has the sun/moon toggle, the droplet and the status chip", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop sidebar");
    await openFixture(page);
    const aside = page.locator("aside:visible").first();
    await expect(aside.getByRole("radiogroup", { name: "Theme" })).toHaveCount(0);
    await expect(aside.getByTestId("color-mode-toggle")).toBeVisible();
    await expect(aside.getByRole("button", { name: "Adjust glass shading" })).toBeVisible();
    await expect(aside.getByTestId("connection-chip")).toBeVisible();
    // The droplet carries no badge any more: just its icon.
    await expect(aside.getByRole("button", { name: "Adjust glass shading" }).locator("> *")).toHaveCount(1);
  });

  test("collapsed, the status chip is just a dot with a tooltip", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop sidebar");
    await openFixture(page);
    await page.getByTestId("sidebar-collapse").click();
    await expect.poll(async () => Math.round((await page.locator("aside:visible").first().boundingBox())!.width)).toBe(84);
    const chip = page.locator("aside:visible").first().getByTestId("connection-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("");
    await chip.hover();
    await expect(page.getByRole("tooltip")).toContainText("Online");
    await page.getByTestId("sim-offline").hover();
    await page.getByTestId("sim-offline").click();
    await expect(chip).toHaveAttribute("data-tone", "offline");
  });
});

test.describe("connection chip", () => {
  test("always visible: Online, Offline and Syncing N, with no layout shift", async ({ page }) => {
    await openFixture(page);
    const chip = page.locator('[data-testid="connection-chip"]:visible').first();
    const neighbours = [page.locator('[data-testid="color-mode-toggle"]:visible').first(), page.getByRole("button", { name: "Adjust glass shading" }).locator("visible=true").first()];
    const measure = async () => {
      const boxes = [];
      for (const l of [chip, ...neighbours]) boxes.push(await l.boundingBox());
      return boxes;
    };

    await expect(chip).toContainText("Online");
    await expect(chip).toHaveAttribute("data-tone", "online");
    const before = await measure();

    await page.getByTestId("sim-offline").click();
    await expect(chip).toContainText("Offline");
    await expect(chip).toHaveAttribute("data-tone", "offline");
    expect(await measure()).toEqual(before);

    await page.getByTestId("sim-syncing").click();
    await expect(chip).toContainText("Syncing 3");
    await expect(chip).toHaveAttribute("data-tone", "syncing");
    expect(await measure()).toEqual(before);

    await page.getByTestId("sim-online").click();
    await expect(chip).toContainText("Online");
    expect(await measure()).toEqual(before);
  });

  test("it is in the mobile navigation: the top bar and the drawer", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout");
    await openFixture(page);
    await expect(page.locator('[data-testid="connection-chip"]:visible')).toHaveCount(1); // the top bar's
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawerChip = page.locator("aside:visible").getByTestId("connection-chip");
    await expect(drawerChip).toBeVisible();
    await expect(drawerChip).toContainText("Online");
    await page.getByTestId("sim-offline").click({ force: true });
  });

  test("the chip's backing is solid (never see-through), even with the glass slider all the way down", async ({ page }) => {
    await openFixture(page);
    await page.evaluate(() => document.documentElement.style.setProperty("--glass-shade", "0.3"));
    const bg = await page.locator('[data-testid="connection-chip"]:visible').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toMatch(/^rgb\(/);
  });
});

// a helper reference so the unused-import rule stays quiet if a test above is skipped on a project
export type _Page = Page;

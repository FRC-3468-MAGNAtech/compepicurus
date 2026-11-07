import { expect, type Page } from "@playwright/test";

export const FIXTURE = "/e2e/theme-check";

/** Opens the test page and waits for the theme provider to have synced (it sets data-theme/data-mode from storage on mount). */
export async function openFixture(page: Page) {
  await page.goto(FIXTURE);
  await expect(page.getByTestId("appearance-panel")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /.+/);
  // Hydrated and at rest: the page-transition wrapper is the last thing above the glass to finish (it is server-rendered at
  // opacity 0 and fades in once React takes over), and clicks before hydration are silently ignored.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-glass="glass-panel"]');
    if (!el) return false;
    for (let a = el.parentElement; a; a = a.parentElement) if (parseFloat(getComputedStyle(a).opacity) < 1) return false;
    return true;
  });
  await settled(page);
}

/** The ~450ms color fade after a theme switch is over (the page is at rest). */
export async function settled(page: Page) {
  await page.waitForFunction(() => !document.documentElement.classList.contains("theme-animating"));
}

export async function pickTheme(page: Page, id: string) {
  await page.locator(`[data-testid="theme-card"][data-theme-id="${id}"]`).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", id);
  await settled(page);
}

export async function pickMode(page: Page, mode: "light" | "dark" | "system") {
  await page.getByTestId(`mode-option-${mode}`).click();
  await settled(page);
}

export const appliedMode = (page: Page) => page.locator("html").getAttribute("data-mode");

/**
 * Runs in the page. For each glass sample: its backdrop filter now, and everything above it that would switch that
 * blur off. An ancestor becomes a "backdrop root" (and the blur inside it stops seeing the page behind) if it has
 * opacity < 1, a filter, a mask, a clip-path, a non-normal mix-blend-mode, a backdrop-filter of its own, or a will-change
 * naming any of those. At rest, none of the glass samples' ancestors may.
 */
export async function inspectGlass(page: Page) {
  return page.evaluate(() => {
    const read = (cs: CSSStyleDeclaration) => {
      const any = cs as unknown as Record<string, string>;
      return cs.getPropertyValue("backdrop-filter") || cs.getPropertyValue("-webkit-backdrop-filter") || any.webkitBackdropFilter || any.backdropFilter || "";
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`;
    const samples: Record<string, string> = {};
    const problems: string[] = [];
    document.querySelectorAll<HTMLElement>("[data-glass]").forEach((el) => {
      const name = el.dataset.glass!;
      const own = read(getComputedStyle(el));
      samples[name] = own;
      if (!own || own === "none") problems.push(`${name}: backdrop-filter is "${own}"`);
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const any = cs as unknown as Record<string, string>;
        const where = `${name} < ${label(a)}`;
        if (parseFloat(cs.opacity) < 1) problems.push(`${where}: opacity ${cs.opacity}`);
        if (cs.filter && cs.filter !== "none") problems.push(`${where}: filter ${cs.filter}`);
        if (/(transform|opacity|filter|backdrop-filter)/.test(cs.willChange)) problems.push(`${where}: will-change ${cs.willChange}`);
        const mask = cs.maskImage || any.webkitMaskImage || "none";
        if (mask !== "none") problems.push(`${where}: mask ${mask}`);
        if (cs.clipPath && cs.clipPath !== "none") problems.push(`${where}: clip-path ${cs.clipPath}`);
        if (cs.mixBlendMode && cs.mixBlendMode !== "normal") problems.push(`${where}: mix-blend-mode ${cs.mixBlendMode}`);
        const up = read(cs);
        if (up && up !== "none") problems.push(`${where}: has its own backdrop-filter ${up}`);
      }
    });
    return { samples, problems, count: Object.keys(samples).length };
  });
}

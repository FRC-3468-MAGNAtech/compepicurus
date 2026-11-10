import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { hasModes, themes } from "../lib/themes";
import { openFixture, pickMode, pickTheme } from "./helpers";

// P32: screenshots of every gradient and pride theme for docs/theme-screenshots/<label>/. Not part of the normal run:
//   THEME_SHOTS=before npx playwright test e2e/theme-shots.e2e.ts --project=chromium-desktop
// (THEME_ONLY=pride-pansexual,pride-intersex limits it to some ids; THEME_SHOT_INTENSITY=normal sets the Gradient intensity first.)
const label = process.env.THEME_SHOTS;
const only = process.env.THEME_ONLY?.split(",").filter(Boolean);

test.describe("theme screenshots", () => {
  test.skip(!label, "set THEME_SHOTS=<label> to take screenshots");

  test("every gradient and pride theme, light and dark", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium-desktop", "desktop Chromium only");
    test.setTimeout(900_000);
    const dir = `docs/theme-screenshots/${label}`;
    mkdirSync(dir, { recursive: true });
    await openFixture(page);
    for (const theme of themes) {
      if (theme.kind === "solid") continue;
      if (only && !only.includes(theme.id)) continue;
      await pickTheme(page, theme.id);
      const modes = hasModes(theme) ? (["light", "dark"] as const) : (["fixed"] as const);
      for (const mode of modes) {
        if (mode !== "fixed") await pickMode(page, mode);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500); // the blobs drift: a fixed beat keeps the shots comparable
        await page.screenshot({ path: `${dir}/${theme.id}-${mode === "fixed" ? "dark" : mode}.jpg`, type: "jpeg", quality: 82 });
      }
    }
  });
});

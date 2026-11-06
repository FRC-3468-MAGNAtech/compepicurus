// Mobile audit runner (P17). Not run in the build environment (no browser there) — run it yourself:
//
//   npm i -D playwright && npx playwright install chromium webkit
//   npm run dev            # in another terminal
//   node scripts/mobile-audit.mjs                       # public pages only
//   AUTH_STATE=.auth/state.json node scripts/mobile-audit.mjs   # every route, signed in
//
// To make AUTH_STATE: sign in once in a Playwright-controlled browser (`npx playwright codegen
// --save-storage=.auth/state.json http://localhost:3000/login`). It loads each route at the five
// sizes the prompt lists (portrait phones, a tablet, a landscape phone), saves a screenshot to
// docs/mobile-audit/, and FAILS if any page scrolls sideways (scrollWidth > clientWidth), which is
// the "no horizontal page scroll anywhere" acceptance check. It also reports touch targets under 44px.

import { mkdirSync } from "node:fs";
import { chromium, webkit } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_STATE = process.env.AUTH_STATE;

const SIZES = [
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024-tablet", width: 768, height: 1024 },
  { name: "844x390-landscape", width: 844, height: 390 },
];

const PUBLIC = ["/", "/login", "/signup"];
const SIGNED_IN = [
  "/dashboard", "/event", "/assignments", "/scout", "/practice-scouting", "/scout-accuracy", "/my-scouting", "/people", "/team-management",
  "/analytics/match-scout", "/analytics/team-averages", "/analytics/match-breakdown", "/analytics/rankings", "/analytics/team-breakdown", "/analytics/pick-list", "/analytics/scout-status",
  "/admin", "/changelog", "/credits", "/account",
];

mkdirSync("docs/mobile-audit", { recursive: true });
const routes = AUTH_STATE ? [...PUBLIC, ...SIGNED_IN] : PUBLIC;
const failures = [];

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: size.width < 768, deviceScaleFactor: 2, ...(AUTH_STATE ? { storageState: AUTH_STATE } : {}) });
    const page = await context.newPage();
    for (const route of routes) {
      await page.goto(BASE + route, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(600); // let entrance animations settle
      const report = await page.evaluate(() => {
        const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const small = [...document.querySelectorAll("button, a, [role=button], select, input:not([type=hidden])")]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width < 44 || r.height < 44)
          .slice(0, 8)
          .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""} ${Math.round(r.width)}x${Math.round(r.height)}`);
        return { sideways, small };
      });
      const file = `docs/mobile-audit/${engine.name()}-${size.name}${route.replace(/\//g, "_") || "_home"}.png`;
      await page.screenshot({ path: file, fullPage: false });
      if (report.sideways > 0) failures.push(`${engine.name()} ${size.name} ${route}: scrolls sideways by ${report.sideways}px`);
      if (report.small.length) console.log(`  small targets on ${size.name} ${route}: ${report.small.join(", ")}`);
    }
    await context.close();
  }
  await browser.close();
}

if (failures.length) {
  console.error("\nHorizontal scroll found:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nNo horizontal page scroll at any size.");

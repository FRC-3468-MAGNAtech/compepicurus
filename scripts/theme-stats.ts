// P32: prints the vibrancy numbers of every gradient and pride theme (first-to-last OKLab distance, the average OKLab lightness of the
// painted page in each mode) and any contrast-guard misses. `npx vite-node scripts/theme-stats.ts`. Not part of the build.
import { hexToOklab, oklabDistance } from "../lib/oklab";
import { auditAllThemes, failures, formatFailures } from "../lib/theme-contrast";
import { hasModes, themes, tokensFor } from "../lib/themes";

const avgL = (stops: string[]) => stops.reduce((s, c) => s + hexToOklab(c)[0], 0) / stops.length;
const f = (n: number) => n.toFixed(2);

console.log("id".padEnd(22), "dist".padStart(5), "darkL".padStart(6), "lightL".padStart(7), "  buttons(dark) text");
for (const t of themes) {
  if (t.kind === "solid") continue;
  const first = t.gradientStops[0];
  const last = t.gradientStops[t.gradientStops.length - 1];
  const dark = tokensFor(t, "dark");
  const light = hasModes(t) ? tokensFor(t, "light") : null;
  console.log(t.id.padEnd(22), f(oklabDistance(first, last)).padStart(5), f(avgL(dark.pageStops)).padStart(6), (light ? f(avgL(light.pageStops)) : "  -").padStart(7), "  ", dark.primary, dark.primaryForeground);
}
const bad = failures(auditAllThemes());
console.log(bad.length ? `\n${bad.length} guard misses:\n${formatFailures(bad)}` : "\nContrast guard: all pass");

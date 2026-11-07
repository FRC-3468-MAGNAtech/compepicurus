// `npm run check:themes` (and `prebuild`): prints the contrast table for every theme x mode and exits 1 on any miss.
import { auditAllThemes, failures, formatFailures } from "../lib/theme-contrast";

const checks = auditAllThemes();
const bad = failures(checks);
const groups = new Set(checks.map((c) => `${c.theme}/${c.mode}`));
console.log(`Theme contrast guard: ${groups.size} theme x mode combinations, ${checks.length} checks.`);
if (bad.length) {
  console.error(`\n${bad.length} check(s) below the WCAG threshold:\n${formatFailures(checks)}\n`);
  process.exit(1);
}
console.log("All pass (text 4.5:1, accent buttons 4.5:1, UI elements and focus rings 3:1).");

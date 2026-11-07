import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// P18, section 7. Glass blur was silently absent in Chrome / Edge / Firefox: Next's CSS pipeline (Lightning CSS, default targets
// Chrome 111 / Safari 16.4) keeps ONLY `-webkit-backdrop-filter` when the unprefixed `backdrop-filter` is written first, and only
// Safari understands the prefixed one. These guards keep that from coming back.

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");

/** Every declaration block that mentions backdrop-filter, as an ordered property list. */
function blocksWithBackdrop(source: string): { selector: string; props: string[] }[] {
  const out: { selector: string; props: string[] }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const props = [...m[2].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
    if (props.some((p) => p.endsWith("backdrop-filter"))) out.push({ selector: m[1].trim().replace(/\s+/g, " "), props });
  }
  return out;
}

describe("glass CSS (P18)", () => {
  const blocks = blocksWithBackdrop(css);

  it("finds the glass rules", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(8);
  });

  it("every rule with backdrop-filter also has -webkit-backdrop-filter, written FIRST", () => {
    for (const { selector, props } of blocks) {
      const prefixed = props.indexOf("-webkit-backdrop-filter");
      const plain = props.indexOf("backdrop-filter");
      expect(prefixed, `${selector}: missing -webkit-backdrop-filter`).toBeGreaterThanOrEqual(0);
      expect(plain, `${selector}: missing backdrop-filter`).toBeGreaterThanOrEqual(0);
      expect(prefixed, `${selector}: -webkit-backdrop-filter must come before backdrop-filter`).toBeLessThan(plain);
    }
  });

  it("does not use Tailwind's backdrop-blur utilities (their generated output loses the unprefixed property)", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(name) && /\bbackdrop-blur(-[a-z0-9]+)?\b/.test(readFileSync(full, "utf8"))) hits.push(path.relative(process.cwd(), full));
      }
    };
    for (const d of ["../app", "../components"]) walk(path.resolve(__dirname, d));
    expect(hits, "use .scrim-blur (app/globals.css) instead").toEqual([]);
  });

  it("survives the real pipeline: after Lightning CSS with Next's default targets, both properties are still there", async () => {
    let lightning: typeof import("lightningcss");
    try {
      lightning = await import("lightningcss");
    } catch {
      return; // not installed in this checkout; the static guards above still apply
    }
    const enc = (major: number, minor = 0) => (major << 16) | (minor << 8);
    const targets = { chrome: enc(111), edge: enc(111), firefox: enc(111), safari: enc(16, 4) };
    const out = lightning.transform({ filename: "globals.css", code: Buffer.from(css), targets, minify: false }).code.toString();
    for (const cls of [".glass-panel", ".glass-card", ".glass-strong", ".glass-overlay", ".glass-pill", ".scrim-blur"]) {
      const rule = new RegExp(`${cls.replace(".", "\\.")}\\s*\\{[^}]*\\}`).exec(out)?.[0] ?? "";
      expect(rule, `${cls} not found in compiled CSS`).not.toBe("");
      expect(rule, `${cls}: unprefixed backdrop-filter was dropped`).toMatch(/(^|[;{\s])backdrop-filter:/);
      expect(rule, `${cls}: -webkit-backdrop-filter was dropped`).toMatch(/-webkit-backdrop-filter:/);
    }
  });
});

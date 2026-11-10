import { describe, expect, it } from "vitest";
import { auditAllThemes, auditTheme, failures, formatFailures, TEXT_MIN, UI_MIN } from "./theme-contrast";
import { themeCss, themeInitScript, tokensToCss } from "./theme-css";
import { defaultThemeId, getTheme, hasModes, isFlagTheme, isThemeId, themeGroups, themes, tokensFor } from "./themes";
import { parseHex } from "./theme-color";

// The contrast guard (P18). This is the test CI runs, and `npm run check:themes` (run by `npm run build`) runs the same audit:
// a theme x mode that can't be read fails the build.
describe("contrast guard: every theme x mode", () => {
  const checks = auditAllThemes();

  it("covers every combination (solid and gradient x light and dark, flags once)", () => {
    const combos = new Set(checks.map((c) => `${c.theme}/${c.mode}`));
    const expected = themes.reduce((n, t) => n + (hasModes(t) ? 2 : 1), 0);
    expect(combos.size).toBe(expected);
  });

  it("body text, text on accent buttons, UI elements and focus rings all pass", () => {
    const bad = failures(checks);
    expect(bad, `\n${formatFailures(checks)}\n`).toEqual([]);
  });

  it("uses the WCAG thresholds the brief asks for", () => {
    expect(TEXT_MIN).toBe(4.5);
    expect(UI_MIN).toBe(3);
  });

  it.each(themes.map((t) => [t.id, t] as const))("%s: is checked for text, accent buttons, fills, and rings in every mode", (_id, theme) => {
    const rules = auditTheme(theme).map((c) => c.rule);
    for (const needle of ["body text", "muted text", "text on accent", "focus ring", "accent fills", "status dots"]) {
      expect(
        rules.some((r) => r.includes(needle)),
        needle
      ).toBe(true);
    }
  });
});

describe("theme registry", () => {
  const group = (label: string) => themeGroups.find((g) => g.label === label)!;

  it("has unique ids, and the original two keep working", () => {
    const ids = themes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isThemeId("team")).toBe(true);
    expect(isThemeId("biobuzz")).toBe(true);
    expect(isThemeId("nope")).toBe(false);
    expect(defaultThemeId).toBe("team");
    expect(getTheme("nope").id).toBe("team");
  });

  it("has the whole solid catalog, with a light and a dark set each", () => {
    const solid = group("Solid").themes;
    expect(solid.map((t) => t.name)).toEqual(["Team Colors", "BIOBUZZ", "Evergreen", "Ocean", "Amethyst", "Blossom", "Obsidian", "Pearl", "Slate"]);
    for (const t of solid) {
      expect(t.kind).toBe("solid");
      expect(hasModes(t)).toBe(true);
    }
  });

  it("has the gradient catalog, with a light and a dark set each", () => {
    const gradients = group("Gradients").themes;
    for (const name of ["Nebula", "Lagoon", "Ember", "Sunset", "Aurora", "Cotton Candy", "Midnight"]) {
      expect(
        gradients.some((t) => t.name === name),
        name
      ).toBe(true);
    }
    expect(gradients.length).toBeGreaterThan(7);
    for (const t of gradients) {
      expect(t.kind).toBe("gradient");
      expect(hasModes(t)).toBe(true);
      expect(t.gradientStops.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("has the pride flags, each with ONE fixed token set and a respectful label", () => {
    const flags = group("Pride").themes;
    for (const name of [
      "Rainbow",
      "Progress",
      "Gay (MLM)",
      "Lesbian",
      "Bisexual",
      "Pansexual",
      "Berri / Laurian",
      "Almond / Verian",
      "Demisexual",
      "Omnisexual",
      "Transgender",
      "Non-binary",
      "Asexual",
      "Aromantic",
      "Genderfluid",
      "Genderqueer",
      "Agender",
      "Polysexual",
      "Intersex",
      "Bigender",
    ]) {
      expect(
        flags.some((t) => t.name === `Pride: ${name}`),
        name
      ).toBe(true);
    }
    for (const t of flags) {
      expect(t.kind).toBe("flag");
      expect(hasModes(t)).toBe(false);
      expect(isFlagTheme(t.id)).toBe(true);
      expect(t.name.startsWith("Pride: ")).toBe(true);
    }
  });

  it("has the four flags of P32 with exactly the supplied colors, each labeled Pride:", () => {
    const stops = (id: string) => getTheme(id).gradientStops;
    expect(stops("pride-pansexual")).toEqual(["#ff218c", "#ffd800", "#21b1ff"]);
    expect(stops("pride-berri-laurian")).toEqual(["#335add", "#358df7", "#83e2ff", "#ffffff", "#cd91f3", "#9d54e3", "#563399"]);
    expect(stops("pride-almond-verian")).toEqual(["#95386f", "#de5990", "#f194b1", "#ffffff", "#a885fb", "#aa3bf2", "#bc39d5"]);
    expect(stops("pride-intersex")).toEqual(["#ffd800", "#7902aa"]);
    expect(getTheme("pride-berri-laurian").name).toBe("Pride: Berri / Laurian");
    expect(getTheme("pride-almond-verian").name).toBe("Pride: Almond / Verian");
    // flag themes keep one fixed look: no light / dark pair
    for (const id of ["pride-pansexual", "pride-berri-laurian", "pride-almond-verian", "pride-intersex"]) {
      expect(hasModes(getTheme(id))).toBe(false);
      expect(isFlagTheme(id)).toBe(true);
    }
  });

  it("flags carry their widely recognized color sequences", () => {
    const stops = (id: string) => getTheme(id).gradientStops;
    expect(stops("pride-transgender")).toEqual(["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"]);
    expect(stops("pride-bisexual")).toEqual(["#d60270", "#9b4f96", "#0038a8"]);
    expect(stops("pride-rainbow")).toHaveLength(6);
    expect(stops("pride-progress").slice(-6)).toEqual(stops("pride-rainbow"));
  });

  it("Team Colors in dark is still the original surface set", () => {
    const t = tokensFor(getTheme("team"), "dark");
    expect(t.background).toBe("#17070c");
    expect(t.foreground).toBe("#f7ede2");
    expect(t.blobs).toEqual(["#3a0d16", "#1a0a12", "#241102"]);
    expect(t.glow).toBe("225, 29, 60");
    expect(t.primaryForeground).toBe("#fff7ed");
    // the red is still the red, to within the nudge that gets the text on it to 4.5:1
    const [r, g, b] = parseHex(t.primary);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(40);
    expect(b).toBeLessThan(70);
  });

  it("neutral themes still switch surfaces and text with the mode", () => {
    for (const id of ["obsidian", "pearl", "slate"]) {
      const dark = tokensFor(getTheme(id), "dark");
      const light = tokensFor(getTheme(id), "light");
      expect(dark.background).not.toBe(light.background);
      expect(dark.foreground).not.toBe(light.foreground);
      expect(dark.colorScheme).toBe("dark");
      expect(light.colorScheme).toBe("light");
    }
  });

  it("a gradient theme carries its gradient on the page itself, in both modes", () => {
    for (const mode of ["dark", "light"] as const) {
      const t = tokensFor(getTheme("nebula"), mode);
      expect(t.gradient.length).toBeGreaterThan(2);
      expect(t.pageStops.length).toBeGreaterThan(1);
    }
    expect(tokensFor(getTheme("nebula"), "dark").background).not.toBe(tokensFor(getTheme("nebula"), "light").background);
  });
});

describe("generated CSS", () => {
  const css = themeCss();
  const REQUIRED = [
    "color-scheme",
    "--background",
    "--foreground",
    "--muted-foreground",
    "--color-primary",
    "--color-primary-foreground",
    "--color-secondary",
    "--color-accent",
    "--theme-stops",
    "--glow",
    "--glow-soft",
    "--surface-tint",
    "--blob-1",
    "--blob-2",
    "--blob-3",
    "--page-bg",
    "--glass-bg",
    "--glass-bg-strong",
    "--glass-border",
    "--glass-shadow",
    "--overlay-bg",
    "--overlay-border",
    "--surface-solid",
    "--focus-ring",
    "--tint-rgb",
    "--status-online",
    "--status-offline",
    "--status-syncing",
  ];

  it("every theme x mode defines every variable (nothing can be missing and silently drop a declaration)", () => {
    for (const t of themes) {
      const sets = hasModes(t) ? [tokensFor(t, "light"), tokensFor(t, "dark")] : [tokensFor(t, "dark")];
      for (const tokens of sets) {
        const body = tokensToCss(tokens);
        for (const v of REQUIRED) expect(body, `${t.id} ${tokens.colorScheme} ${v}`).toContain(`${v}:`);
        expect(body).not.toMatch(/undefined|NaN|null/);
      }
    }
  });

  it("emits one rule per mode for solid and gradient themes, and one fixed rule per flag", () => {
    for (const t of themes) {
      if (hasModes(t)) {
        expect(css).toContain(`html[data-theme="${t.id}"][data-mode="dark"]{`);
        expect(css).toContain(`html[data-theme="${t.id}"][data-mode="light"]{`);
      } else {
        expect(css).toContain(`html[data-theme="${t.id}"]{`);
        expect(css).not.toContain(`html[data-theme="${t.id}"][data-mode`);
      }
    }
  });

  it("the default theme in dark is also :root, so nothing is ever unthemed", () => {
    expect(css.startsWith(":root{")).toBe(true);
  });

  it("never sets opacity, filter, transform, mask or will-change (those would turn an ancestor into a backdrop root)", () => {
    expect(css).not.toMatch(/(^|[;{])\s*(opacity|filter|transform|mask|will-change|backdrop-filter)\s*:/);
  });

  it("the overlay keeps the glass-level multiplier", () => {
    expect(css).toContain("calc(0.82 * var(--glass-shade))");
  });
});

describe("pre-paint script", () => {
  function run(opts: { stored?: Record<string, string>; light?: boolean; storageThrows?: boolean }) {
    const attrs: Record<string, string> = { "data-theme": "team", "data-mode": "dark" };
    const props: Record<string, string> = {};
    const doc = {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
        style: {
          setProperty: (k: string, v: string) => {
            props[k] = v;
          },
        },
      },
    };
    const storage = {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error("blocked");
        return opts.stored?.[k] ?? null;
      },
    };
    const win = { matchMedia: (q: string) => ({ matches: q.includes("light") ? !!opts.light : false }) };
    new Function("document", "localStorage", "window", "matchMedia", themeInitScript())(doc, storage, win, win.matchMedia);
    return { attrs, props };
  }

  it("applies the saved theme and mode before paint", () => {
    const { attrs } = run({ stored: { "compepicurus.theme": "ocean", "compepicurus.colorMode": "light" } });
    expect(attrs).toMatchObject({ "data-theme": "ocean", "data-mode": "light" });
  });

  it("follows the system when no mode was ever chosen", () => {
    expect(run({ light: true }).attrs).toMatchObject({ "data-theme": "team", "data-mode": "light" });
    expect(run({ light: false }).attrs).toMatchObject({ "data-theme": "team", "data-mode": "dark" });
  });

  it("a flag theme is applied dark whatever the saved mode (the choice itself stays in storage)", () => {
    const { attrs } = run({ stored: { "compepicurus.theme": "pride-bisexual", "compepicurus.colorMode": "light" }, light: true });
    expect(attrs).toMatchObject({ "data-theme": "pride-bisexual", "data-mode": "dark" });
  });

  it("falls back to the default for an unknown theme or a bad mode", () => {
    const { attrs } = run({ stored: { "compepicurus.theme": "gone", "compepicurus.colorMode": "weird" }, light: true });
    expect(attrs).toMatchObject({ "data-theme": "team", "data-mode": "light" });
  });

  it("still works with storage blocked", () => {
    expect(run({ storageThrows: true, light: true }).attrs).toMatchObject({ "data-theme": "team", "data-mode": "light" });
  });

  it("restores the glass level too", () => {
    expect(run({ stored: { "compepicurus.glass-shade": "1.4" } }).props["--glass-shade"]).toBe("1.4");
    expect(run({ stored: { "compepicurus.glass-shade": "9" } }).props["--glass-shade"]).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  COLLAPSED_STRIP_PX,
  FORM_DEFAULT_FRACTION,
  MINI_VIDEO_PX,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  WORKSPACE_STORAGE_KEYS,
  clampFormWidth,
  clampSplit,
  fitContain,
  formWidthLimits,
  fractionToWidth,
  isTypingTarget,
  parseFraction,
  phoneVideoHeight,
  readFraction,
  resolveFraction,
  shortcutFor,
  stepFormWidth,
  stepSplit,
  widthToFraction,
  writeFraction,
  type LayoutStorage,
} from "@/lib/workspace/layout";

describe("fitContain: the biggest 16:9 that fits", () => {
  it("is limited by width in a tall pane and by height in a wide one", () => {
    expect(fitContain(1600, 2000)).toEqual({ width: 1600, height: 900 });
    expect(fitContain(2000, 450)).toEqual({ width: 800, height: 450 });
  });
  it("fills an exactly 16:9 pane, and never exceeds the pane", () => {
    expect(fitContain(1280, 720)).toEqual({ width: 1280, height: 720 });
    for (const [w, h] of [[333, 777], [1001, 333], [17, 9], [640, 360]] as const) {
      const r = fitContain(w, h);
      expect(r.width).toBeLessThanOrEqual(w);
      expect(r.height).toBeLessThanOrEqual(h);
      expect(Math.abs(r.width / r.height - 16 / 9)).toBeLessThan(0.2);
    }
  });
  it("is zero (not NaN) before the pane has a size", () => {
    expect(fitContain(0, 500)).toEqual({ width: 0, height: 0 });
    expect(fitContain(500, -1)).toEqual({ width: 0, height: 0 });
    expect(fitContain(NaN, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe("form width limits and clamping", () => {
  it("is at least 320px and at most 60% of the workspace", () => {
    expect(formWidthLimits(1200)).toEqual({ min: 320, max: 720 });
    expect(clampFormWidth(100, 1200)).toBe(320);
    expect(clampFormWidth(900, 1200)).toBe(720);
    expect(clampFormWidth(500, 1200)).toBe(500);
  });
  it("lets the maximum win on a workspace too narrow for the minimum", () => {
    expect(formWidthLimits(400)).toEqual({ min: 240, max: 240 });
    expect(clampFormWidth(999, 400)).toBe(240);
    expect(formWidthLimits(0)).toEqual({ min: 0, max: 0 });
  });
  it("rounds, and falls back to the default share for junk", () => {
    expect(clampFormWidth(500.6, 1200)).toBe(501);
    expect(clampFormWidth(NaN, 1000)).toBe(380);
  });
  it("converts to and from a share of the workspace, so a resized window keeps the proportion", () => {
    expect(widthToFraction(480, 1200)).toBe(0.4);
    expect(widthToFraction(500, 1280)).toBeCloseTo(0.39063, 5); // precise enough that a saved width reproduces the same pixels
    expect(fractionToWidth(0.4, 1200)).toBe(480);
    expect(fractionToWidth(0.4, 2000)).toBe(800); // wider window, wider form
    expect(fractionToWidth(0.05, 1200)).toBe(320); // clamped
    expect(widthToFraction(10, 0)).toBe(FORM_DEFAULT_FRACTION);
  });
  it("steps with the arrow keys (left grows the form), Shift for big steps, Home/End for the extremes", () => {
    expect(stepFormWidth(500, "ArrowLeft", 1200)).toBe(516);
    expect(stepFormWidth(500, "ArrowRight", 1200)).toBe(484);
    expect(stepFormWidth(500, "ArrowLeft", 1200, true)).toBe(564);
    expect(stepFormWidth(330, "ArrowRight", 1200, true)).toBe(320);
    expect(stepFormWidth(700, "ArrowLeft", 1200, true)).toBe(720);
    expect(stepFormWidth(500, "Home", 1200)).toBe(320);
    expect(stepFormWidth(500, "End", 1200)).toBe(720);
    expect(stepFormWidth(500, "Enter", 1200)).toBeNull();
    expect(stepFormWidth(500, "ArrowUp", 1200)).toBeNull();
  });
});

describe("remembering the width", () => {
  it("accepts only a number strictly between 0 and 1", () => {
    for (const ok of [0.4, 0.001, 0.999, "0.5"]) expect(parseFraction(ok)).not.toBeNull();
    for (const bad of [0, 1, -0.2, 1.5, NaN, Infinity, "", "abc", null, undefined, {}, true]) expect(parseFraction(bad)).toBeNull();
  });
  it("prefers the account's value, then this browser's, then the default, skipping unusable values", () => {
    expect(resolveFraction(0.5, 0.3, 0.38)).toBe(0.5);
    expect(resolveFraction(undefined, 0.3, 0.38)).toBe(0.3);
    expect(resolveFraction(7, "0.3", 0.38)).toBe(0.3);
    expect(resolveFraction(undefined, null, 0.38)).toBe(0.38);
    expect(resolveFraction("junk", "junk", 0.38)).toBe(0.38);
  });
  const memory = (): LayoutStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  it("round-trips through storage, and survives storage that is missing or blocked", () => {
    const s = memory();
    writeFraction(s, WORKSPACE_STORAGE_KEYS.formFraction, 0.42);
    expect(readFraction(s, WORKSPACE_STORAGE_KEYS.formFraction)).toBe(0.42);
    expect(readFraction(s, "nothing")).toBeNull();
    s.data.set("bad", "NaN");
    expect(readFraction(s, "bad")).toBeNull();
    expect(readFraction(null, "x")).toBeNull();
    const blocked: LayoutStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFraction(blocked, "x")).toBeNull();
    expect(() => writeFraction(blocked, "x", 0.5)).not.toThrow();
  });
  it("a saved width reproduces the same pixel width after a reload at the same window size", () => {
    const s = memory();
    const container = 1280;
    const dragged = clampFormWidth(530, container);
    writeFraction(s, WORKSPACE_STORAGE_KEYS.formFraction, widthToFraction(dragged, container));
    const restored = fractionToWidth(resolveFraction(undefined, readFraction(s, WORKSPACE_STORAGE_KEYS.formFraction), FORM_DEFAULT_FRACTION), container);
    expect(Math.abs(restored - dragged)).toBeLessThanOrEqual(1);
  });
});

describe("phone split", () => {
  it("clamps the video's share and falls back for junk", () => {
    expect(clampSplit(0.05)).toBe(SPLIT_MIN);
    expect(clampSplit(0.95)).toBe(SPLIT_MAX);
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(NaN)).toBe(SPLIT_DEFAULT);
  });
  it("sizes the video as a share of the workspace, or as the mini player", () => {
    expect(phoneVideoHeight(800, 0.4, false)).toBe(320);
    expect(phoneVideoHeight(800, 0.9, false)).toBe(560);
    expect(phoneVideoHeight(800, 0.4, true)).toBe(MINI_VIDEO_PX);
    expect(phoneVideoHeight(50, 0.4, true)).toBe(50);
  });
  it("steps with the arrow keys (up shrinks the video)", () => {
    expect(stepSplit(0.4, "ArrowUp")).toBeCloseTo(0.36);
    expect(stepSplit(0.4, "ArrowDown")).toBeCloseTo(0.44);
    expect(stepSplit(0.25, "ArrowUp", true)).toBe(SPLIT_MIN);
    expect(stepSplit(0.4, "Home")).toBe(SPLIT_MIN);
    expect(stepSplit(0.4, "End")).toBe(SPLIT_MAX);
    expect(stepSplit(0.4, "x")).toBeNull();
  });
  it("has a strip narrower than the minimum form", () => {
    expect(COLLAPSED_STRIP_PX).toBeLessThan(320);
  });
});

describe("keyboard shortcuts", () => {
  const body = { tagName: "BODY" };
  it("F toggles focus mode, C opens comments, Escape closes the drawer only when it is open", () => {
    expect(shortcutFor({ key: "f", target: body }, false)).toBe("focus");
    expect(shortcutFor({ key: "F", target: body }, false)).toBe("focus");
    expect(shortcutFor({ key: "c", target: body }, false)).toBe("comments");
    expect(shortcutFor({ key: "Escape", target: body }, true)).toBe("close-comments");
    expect(shortcutFor({ key: "Escape", target: body }, false)).toBeNull();
    expect(shortcutFor({ key: "x", target: body }, false)).toBeNull();
  });
  it("ignores letters while typing, with a modifier held, or when already handled", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(shortcutFor({ key: "c", target: { tagName } }, false)).toBeNull();
    expect(shortcutFor({ key: "c", target: { tagName: "DIV", isContentEditable: true } }, false)).toBeNull();
    expect(shortcutFor({ key: "c", ctrlKey: true, target: body }, false)).toBeNull(); // copy
    expect(shortcutFor({ key: "f", metaKey: true, target: body }, false)).toBeNull(); // find
    expect(shortcutFor({ key: "f", altKey: true, target: body }, false)).toBeNull();
    expect(shortcutFor({ key: "f", defaultPrevented: true, target: body }, false)).toBeNull();
  });
  it("Escape still closes the drawer from inside the comments box", () => {
    expect(shortcutFor({ key: "Escape", target: { tagName: "TEXTAREA" } }, true)).toBe("close-comments");
  });
  it("knows what a typing target is", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

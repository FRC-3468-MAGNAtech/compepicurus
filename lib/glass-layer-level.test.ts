import { describe, expect, it } from "vitest";
import { connectionNotice } from "./connection-notice";
import {
  GLASS_LAYER_DEFAULT,
  GLASS_LAYER_MAX,
  GLASS_LAYER_MIN,
  clampGlassLayerLevel,
  formatGlassLayerLevel,
  isGlassLayerLevel,
  parseStoredLevel,
  resolveGlassLayerLevel,
  shouldSaveLocalLevelToProfile,
} from "./glass-layer-level";

describe("glass layer level", () => {
  it("accepts only numbers in range", () => {
    expect(isGlassLayerLevel(1)).toBe(true);
    expect(isGlassLayerLevel(GLASS_LAYER_MIN)).toBe(true);
    expect(isGlassLayerLevel(GLASS_LAYER_MAX)).toBe(true);
    for (const bad of [0, 0.29, 2.01, Number.NaN, Number.POSITIVE_INFINITY, "1", null, undefined, {}]) expect(isGlassLayerLevel(bad), String(bad)).toBe(false);
  });

  it("clamps into range, and falls back to the default for garbage", () => {
    expect(clampGlassLayerLevel(5)).toBe(GLASS_LAYER_MAX);
    expect(clampGlassLayerLevel(-1)).toBe(GLASS_LAYER_MIN);
    expect(clampGlassLayerLevel(0.8)).toBe(0.8);
    expect(clampGlassLayerLevel(Number.NaN)).toBe(GLASS_LAYER_DEFAULT);
  });

  it("reads a stored value, ignoring anything unusable", () => {
    expect(parseStoredLevel("0.85")).toBe(0.85);
    expect(parseStoredLevel("2")).toBe(2);
    for (const bad of [null, undefined, "", "  ", "abc", "9", "0", "-1"]) expect(parseStoredLevel(bad), String(bad)).toBeNull();
  });

  it("the signed-in user's saved level wins, then this browser's, then the default", () => {
    expect(resolveGlassLayerLevel(0.6, 1.4)).toBe(0.6);
    expect(resolveGlassLayerLevel(undefined, 1.4)).toBe(1.4);
    expect(resolveGlassLayerLevel(Number.NaN, 1.4)).toBe(1.4);
    expect(resolveGlassLayerLevel(undefined, null)).toBe(GLASS_LAYER_DEFAULT);
    expect(resolveGlassLayerLevel(99, null)).toBe(GLASS_LAYER_DEFAULT); // an out-of-range saved value is ignored, not clamped
  });

  it("a level only this browser has is saved to the account once; one the account already has is not", () => {
    expect(shouldSaveLocalLevelToProfile(undefined, 1.4)).toBe(true);
    expect(shouldSaveLocalLevelToProfile(0.6, 1.4)).toBe(false);
    expect(shouldSaveLocalLevelToProfile(undefined, null)).toBe(false);
  });

  it("formats the readout", () => {
    expect(formatGlassLayerLevel(1)).toBe("100%");
    expect(formatGlassLayerLevel(0.85)).toBe("85%");
    expect(formatGlassLayerLevel(0.3)).toBe("30%");
  });
});

describe("the offline safety signal", () => {
  it("shows nothing when online with nothing waiting to sync", () => {
    expect(connectionNotice(true, 0)).toBeNull();
  });

  it("says so when offline — with or without unsynced submissions", () => {
    expect(connectionNotice(false, 0)).toMatchObject({ tone: "offline", pending: 0 });
    expect(connectionNotice(false, 0)?.message).toMatch(/^Offline:/);
    expect(connectionNotice(false, 3)).toMatchObject({ tone: "offline", pending: 3, message: "Offline: 3 submissions will sync when you're back online." });
    expect(connectionNotice(false, 1)?.message).toBe("Offline: 1 submission will sync when you're back online.");
  });

  it("says so when online but submissions haven't synced yet", () => {
    expect(connectionNotice(true, 2)).toMatchObject({ tone: "syncing", pending: 2, message: "2 submissions still syncing to the server." });
    expect(connectionNotice(true, 1)?.message).toBe("1 submission still syncing to the server.");
  });

  it("never shows a negative or fractional count", () => {
    expect(connectionNotice(true, -4)).toBeNull();
    expect(connectionNotice(true, 2.9)?.pending).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { UNKNOWN_CLIP_FALLBACK_SEC, clipDurationOrFallback, clipDurationSec, clipProgress, hasReachedEnd, windowEnd, windowStart, youTubeWindowVars } from "./video-window";

const BLANK = { startSec: null, endSec: null };
const START_ONLY = { startSec: 30, endSec: null };
const END_ONLY = { startSec: null, endSec: 150 };
const BOTH = { startSec: 30, endSec: 180 };

describe("start and end are optional", () => {
  it("blank start plays from the beginning; blank end means the video's own end", () => {
    expect(windowStart(BLANK)).toBe(0);
    expect(windowEnd(BLANK)).toBeNull();
    expect(windowStart(START_ONLY)).toBe(30);
    expect(windowEnd(START_ONLY)).toBeNull();
    expect(windowStart(END_ONLY)).toBe(0);
    expect(windowEnd(END_ONLY)).toBe(150);
    expect(windowStart(BOTH)).toBe(30);
    expect(windowEnd(BOTH)).toBe(180);
  });

  it("treats undefined, missing, negative, and non-finite times as blank", () => {
    expect(windowStart({})).toBe(0);
    expect(windowEnd({})).toBeNull();
    expect(windowStart(undefined)).toBe(0);
    expect(windowEnd(null)).toBeNull();
    expect(windowStart({ startSec: -5 })).toBe(0);
    expect(windowEnd({ endSec: Number.NaN })).toBeNull();
    expect(windowEnd({ endSec: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("keeps a start of 0 and an end given as 0 distinct from blank only where it matters", () => {
    expect(windowStart({ startSec: 0 })).toBe(0);
    expect(windowEnd({ endSec: 0 })).toBe(0); // given, even though useless: an end of 0 is never reached after a start of 0
  });
});

describe("clip duration", () => {
  it("both: end minus start, independent of the video length", () => {
    expect(clipDurationSec(BOTH, null)).toBe(150);
    expect(clipDurationSec(BOTH, 600)).toBe(150);
  });

  it("end only: the end time itself (the clip starts at 0)", () => {
    expect(clipDurationSec(END_ONLY, null)).toBe(150);
  });

  it("start only: the rest of the video — unknown until the player reports its length", () => {
    expect(clipDurationSec(START_ONLY, null)).toBeNull();
    expect(clipDurationSec(START_ONLY, 600)).toBe(570);
    expect(clipDurationSec(START_ONLY, 20)).toBeNull(); // a reported length shorter than the start is nonsense
  });

  it("neither: the whole video — unknown until the player reports its length", () => {
    expect(clipDurationSec(BLANK, null)).toBeNull();
    expect(clipDurationSec(BLANK, 600)).toBe(600);
    expect(clipDurationSec(BLANK, 0)).toBeNull();
    expect(clipDurationSec(null, 150)).toBe(150); // no video at all (the placeholder): its own length
  });

  it("an end that isn't after the start has no duration", () => {
    expect(clipDurationSec({ startSec: 100, endSec: 100 }, 600)).toBeNull();
    expect(clipDurationSec({ startSec: 100, endSec: 50 }, 600)).toBeNull();
  });

  it("the fallback version never returns null", () => {
    expect(clipDurationOrFallback(BLANK, null)).toBe(UNKNOWN_CLIP_FALLBACK_SEC);
    expect(clipDurationOrFallback(START_ONLY, null, 99)).toBe(99);
    expect(clipDurationOrFallback(BOTH, null)).toBe(150);
    expect(clipDurationOrFallback(BLANK, 240)).toBe(240);
  });
});

describe("clip progress (what the Finished Early flag reads)", () => {
  it("both: how far between start and end", () => {
    expect(clipProgress(30, BOTH, null)).toBe(0);
    expect(clipProgress(105, BOTH, null)).toBe(0.5);
    expect(clipProgress(180, BOTH, null)).toBe(1);
    expect(clipProgress(999, BOTH, null)).toBe(1); // clamped
    expect(clipProgress(0, BOTH, null)).toBe(0); // before the start
  });

  it("end only: measured from 0", () => {
    expect(clipProgress(75, END_ONLY, null)).toBe(0.5);
  });

  it("start only: video duration minus the start is the denominator; skipped (null) when the duration is unknown", () => {
    expect(clipProgress(330, START_ONLY, 630)).toBeCloseTo(0.5, 5); // (330-30)/(630-30)
    expect(clipProgress(330, START_ONLY, null)).toBeNull();
  });

  it("neither: the whole video; null when the duration is unknown", () => {
    expect(clipProgress(60, BLANK, 120)).toBe(0.5);
    expect(clipProgress(60, BLANK, null)).toBeNull();
    expect(clipProgress(60, null, null)).toBeNull();
  });
});

describe("player settings", () => {
  it("always sets a start, and an end only when there is one", () => {
    expect(youTubeWindowVars(BLANK)).toEqual({ start: 0 });
    expect(youTubeWindowVars(START_ONLY)).toEqual({ start: 30 });
    expect(youTubeWindowVars(END_ONLY)).toEqual({ start: 0, end: 150 });
    expect(youTubeWindowVars(BOTH)).toEqual({ start: 30, end: 180 });
    expect(youTubeWindowVars({ startSec: 30.7, endSec: 180.2 })).toEqual({ start: 30, end: 181 });
  });

  it("only ends the clip at an end time that exists", () => {
    expect(hasReachedEnd(9999, BLANK)).toBe(false);
    expect(hasReachedEnd(9999, START_ONLY)).toBe(false);
    expect(hasReachedEnd(149, END_ONLY)).toBe(false);
    expect(hasReachedEnd(150, END_ONLY)).toBe(true);
    expect(hasReachedEnd(179, BOTH)).toBe(false);
    expect(hasReachedEnd(180, BOTH)).toBe(true);
  });
});

// P24: the pure math and rules behind the ScoutingWorkspace (components/practice/scouting-workspace.tsx): how big the 16:9 video can be in its pane, how wide
// the form may be and how that is remembered, the phone's video/form split, the keyboard shortcuts, and what is stored. No React and no DOM, so all of it is tested.

export const VIDEO_ASPECT = 16 / 9;

/** The largest `aspect` box that fits (contain) in a w x h pane, in whole pixels. Zero while the pane has no size yet. */
export function fitContain(width: number, height: number, aspect: number = VIDEO_ASPECT): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !(aspect > 0)) return { width: 0, height: 0 };
  let w = width;
  let h = w / aspect;
  if (h > height) {
    h = height;
    w = h * aspect;
  }
  const out = { width: Math.floor(w), height: Math.floor(h) };
  return out.width < 1 || out.height < 1 ? { width: 0, height: 0 } : out;
}

// --- the form pane's width (tablet and desktop) -----------------------------------------------------------------------------

export const FORM_MIN_PX = 320;
export const FORM_MAX_FRACTION = 0.6;
export const FORM_DEFAULT_FRACTION = 0.38;
/** The form collapsed to a strip (Focus mode). */
export const COLLAPSED_STRIP_PX = 44;
export const DIVIDER_PX = 12;
export const KEY_STEP_PX = 16;
export const KEY_STEP_BIG_PX = 64;

/** The form may be at least ~320px and at most 60% of the workspace (on a workspace too narrow for 320px, the minimum gives way to the maximum). */
export function formWidthLimits(containerPx: number): { min: number; max: number } {
  const max = Math.max(0, Math.floor(containerPx * FORM_MAX_FRACTION));
  return { min: Math.min(FORM_MIN_PX, max), max };
}

export function clampFormWidth(px: number, containerPx: number): number {
  const { min, max } = formWidthLimits(containerPx);
  if (!Number.isFinite(px)) return Math.min(Math.max(Math.round(containerPx * FORM_DEFAULT_FRACTION), min), max);
  return Math.round(Math.min(Math.max(px, min), max));
}

/** A stored fraction is only usable when it is a number strictly between 0 and 1. */
export function parseFraction(raw: unknown): number | null {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

/** The saved width wins from the account (it follows the user across devices), then this browser's, then the default. Anything unusable is skipped. */
export function resolveFraction(userValue: unknown, localValue: unknown, fallback: number): number {
  return parseFraction(userValue) ?? parseFraction(localValue) ?? fallback;
}

/** A width is stored as a share of the workspace, so it still makes sense after the window is resized. */
export const widthToFraction = (px: number, containerPx: number): number => (containerPx > 0 ? Math.round((px / containerPx) * 100000) / 100000 : FORM_DEFAULT_FRACTION);
export const fractionToWidth = (fraction: number, containerPx: number): number => clampFormWidth(fraction * containerPx, containerPx);

/**
 * Keyboard resizing of the vertical divider (it sits between the video on the left and the form on the right): ArrowLeft moves it left, so the form grows; ArrowRight
 * shrinks it; Shift takes bigger steps; Home gives the form its minimum (the biggest video), End its maximum. Returns the new width, or null for any other key.
 */
export function stepFormWidth(current: number, key: string, containerPx: number, shift = false): number | null {
  const step = shift ? KEY_STEP_BIG_PX : KEY_STEP_PX;
  const { min, max } = formWidthLimits(containerPx);
  switch (key) {
    case "ArrowLeft":
      return clampFormWidth(current + step, containerPx);
    case "ArrowRight":
      return clampFormWidth(current - step, containerPx);
    case "Home":
      return min;
    case "End":
      return max;
    default:
      return null;
  }
}

// --- the phone's video / form split --------------------------------------------------------------------------------------------

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.7;
export const SPLIT_DEFAULT = 0.4;
/** The collapsed ("mini") video's height. */
export const MINI_VIDEO_PX = 96;
export const SPLIT_KEY_STEP = 0.04;

export const clampSplit = (fraction: number): number => (Number.isFinite(fraction) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, fraction)) : SPLIT_DEFAULT);

/** The video's height on a phone: its share of the workspace, or the mini player's. */
export function phoneVideoHeight(containerPx: number, fraction: number, mini: boolean): number {
  if (mini) return Math.min(MINI_VIDEO_PX, Math.max(0, containerPx));
  return Math.round(Math.max(0, containerPx) * clampSplit(fraction));
}

/** Keyboard resizing of the horizontal handle (video above, form below): ArrowUp moves it up (a smaller video), ArrowDown down. */
export function stepSplit(current: number, key: string, shift = false): number | null {
  const step = shift ? SPLIT_KEY_STEP * 2.5 : SPLIT_KEY_STEP;
  switch (key) {
    case "ArrowUp":
      return clampSplit(current - step);
    case "ArrowDown":
      return clampSplit(current + step);
    case "Home":
      return SPLIT_MIN;
    case "End":
      return SPLIT_MAX;
    default:
      return null;
  }
}

// --- keyboard shortcuts -----------------------------------------------------------------------------------------------------------

export type ShortcutEvent = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; defaultPrevented?: boolean; target?: { tagName?: string; isContentEditable?: boolean } | null };

export function isTypingTarget(target: ShortcutEvent["target"]): boolean {
  const tag = target?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
}

export type WorkspaceShortcut = "focus" | "comments" | "close-comments";

/**
 * F toggles Focus mode, C opens the comments drawer, Escape closes it. Letters are ignored while typing in a field (so a scout typing "cafe" in a comment
 * doesn't toggle anything) and with Ctrl/Cmd/Alt held (browser shortcuts). Nothing here touches the video, so Competitive stays no-pause.
 */
export function shortcutFor(e: ShortcutEvent, commentsOpen: boolean): WorkspaceShortcut | null {
  if (e.defaultPrevented) return null;
  if (e.key === "Escape") return commentsOpen ? "close-comments" : null;
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return null;
  const k = e.key.toLowerCase();
  if (k === "f") return "focus";
  if (k === "c") return "comments";
  return null;
}

// --- remembering the layout ---------------------------------------------------------------------------------------------------------

export const WORKSPACE_STORAGE_KEYS = { formFraction: "workspace-form-fraction", phoneSplit: "workspace-phone-split" } as const;

export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export function readFraction(storage: LayoutStorage | null, key: string): number | null {
  try {
    return storage ? parseFraction(storage.getItem(key)) : null;
  } catch {
    return null; // storage blocked
  }
}

export function writeFraction(storage: LayoutStorage | null, key: string, value: number): void {
  try {
    storage?.setItem(key, String(value));
  } catch {
    // storage blocked: the layout still applies for this session
  }
}

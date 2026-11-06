// Time helpers for manual library matches (P15). Pure.

const MAX_SECONDS = 24 * 3600;

/**
 * Parses a video time an admin typed: `90`, `90.5`, `1:30`, `1:02:30`, or the
 * YouTube forms `90s` / `1m30s` / `1h2m3s`. Returns whole-or-fractional seconds,
 * or null for anything else (empty, negative, `1:75`, letters, over 24 hours).
 */
export function parseTimeInput(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === "") return null;

  let seconds: number | null = null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    seconds = Number(text);
  } else if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.length === 2) {
      const [m, s] = parts;
      if (s < 60) seconds = m * 60 + s;
    } else {
      const [h, m, s] = parts;
      if (m < 60 && s < 60) seconds = h * 3600 + m * 60 + s;
    }
  } else if (/^(\d+h)?(\d+m)?(\d+s)?$/.test(text)) {
    const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)!;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }

  if (seconds === null || !Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SECONDS) return null;
  return seconds;
}

/** `m:ss`, or `h:mm:ss` from an hour up. Fractions are rounded to the nearest second. */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** A match clip should end after it starts. Returns an error message, or null when fine. */
export function validateVideoWindow(startSec: number, endSec: number): string | null {
  if (!(startSec >= 0)) return "The start time can't be negative.";
  if (!(endSec > startSec)) return "The end time must be after the start time.";
  return null;
}

/** A clip longer than this is probably a whole stream rather than one match — worth a (non-blocking) warning. */
export const LONG_CLIP_SECONDS = 10 * 60;

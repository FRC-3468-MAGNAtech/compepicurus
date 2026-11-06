// A library match's video clip, where the start and end times are both OPTIONAL
// (FIX3). Pure; every consumer — the player, the practice screens, the lobby
// deadline, the "Finished Early" flag, the admin tables — goes through here so the
// four cases mean the same thing everywhere:
//
//   start | end   | plays from        | match ends
//   ------+-------+-------------------+------------------------------------------
//   blank | blank | the beginning (0) | when the video ends
//   given | blank | the start         | when the video ends
//   blank | given | the beginning (0) | at the end time
//   given | given | the start         | at the end time
//
// A time is "blank" when it is null, undefined, or not a usable number.

export type VideoWindow = { startSec?: number | null; endSec?: number | null };

/** Used for a lobby's results deadline when the clip has no end time and its length isn't known to the client. */
export const UNKNOWN_CLIP_FALLBACK_SEC = 10 * 60;

const usable = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Where playback starts: the start time, or 0. */
export const windowStart = (video: VideoWindow | null | undefined): number => (usable(video?.startSec) ? video.startSec : 0);

/** Where the match ends, or null when it ends with the video. */
export const windowEnd = (video: VideoWindow | null | undefined): number | null => (usable(video?.endSec) ? video.endSec : null);

/**
 * The length of the clip in seconds. With an end time that is `end - start`;
 * without one it is the rest of the video, which needs `mediaDurationSec` (the
 * player's reported length) — null when that isn't known yet.
 */
export function clipDurationSec(video: VideoWindow | null | undefined, mediaDurationSec: number | null): number | null {
  const start = windowStart(video);
  const end = windowEnd(video);
  if (end !== null) return end > start ? end - start : null;
  if (mediaDurationSec !== null && Number.isFinite(mediaDurationSec) && mediaDurationSec > start) return mediaDurationSec - start;
  return null;
}

/** Like `clipDurationSec`, but never null — for deadlines, where "unknown" has to become some bound. */
export const clipDurationOrFallback = (video: VideoWindow | null | undefined, mediaDurationSec: number | null, fallbackSec: number = UNKNOWN_CLIP_FALLBACK_SEC): number =>
  clipDurationSec(video, mediaDurationSec) ?? fallbackSec;

/**
 * How far through the clip playback is, 0 to 1 — or null when the clip's length
 * isn't known (no end time and the player hasn't reported a duration). Callers
 * that need a threshold, like the "Finished Early" flag, skip it on null rather than guess.
 */
export function clipProgress(currentSec: number, video: VideoWindow | null | undefined, mediaDurationSec: number | null): number | null {
  const duration = clipDurationSec(video, mediaDurationSec);
  if (duration === null || duration <= 0) return null;
  return Math.min(1, Math.max(0, (currentSec - windowStart(video)) / duration));
}

/** YouTube embed `playerVars` for the window: `start` always, `end` only when there is one. */
export function youTubeWindowVars(video: VideoWindow | null | undefined): { start: number; end?: number } {
  const end = windowEnd(video);
  return end === null ? { start: Math.floor(windowStart(video)) } : { start: Math.floor(windowStart(video)), end: Math.ceil(end) };
}

/** Whether the polling safety net should end the clip now: only when there is an end time and playback has reached it. */
export const hasReachedEnd = (currentSec: number, video: VideoWindow | null | undefined): boolean => {
  const end = windowEnd(video);
  return end !== null && currentSec >= end;
};

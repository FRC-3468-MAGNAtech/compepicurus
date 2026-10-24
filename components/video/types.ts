/** One interface both MockVideoPlayer and the real (YouTube) player implement, so callers never need to know which one they got. */
export type VideoPlayerHandle = {
  play: () => void;
  /** No-ops when the player was created with `lockPause` (Competitive mode, P4). */
  pause: () => void;
  seek: (seconds: number) => void;
  getCurrentTime: () => number;
};

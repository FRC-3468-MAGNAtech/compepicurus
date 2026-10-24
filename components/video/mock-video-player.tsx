"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Clapperboard, Pause, Play } from "lucide-react";
import { motion } from "framer-motion";
import type { VideoPlayerHandle } from "@/components/video/types";

/** ~2:30, per the spec — long enough to feel like a real match video without making manual testing tedious. */
export const MOCK_VIDEO_DURATION_SEC = 150;

export type MockVideoPlayerProps = {
  lockPause?: boolean;
  onEnded?: () => void;
  onPause?: () => void;
};

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A clearly-labeled placeholder "video" that simulates a match timeline with
 * the same play/pause/ended interface as the real player — lets P4's
 * practice-scouting flows be built and tested end to end before any real
 * video exists. Never confusable with a real video (no actual footage, an
 * explicit "Placeholder video" label).
 */
export const MockVideoPlayer = forwardRef<VideoPlayerHandle, MockVideoPlayerProps>(function MockVideoPlayer(
  { lockPause, onEnded, onPause },
  ref
) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const stopLoop = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
  };

  useEffect(() => stopLoop, []);

  const tick = (ts: number) => {
    if (lastTsRef.current === null) lastTsRef.current = ts;
    const deltaSec = (ts - lastTsRef.current) / 1000;
    lastTsRef.current = ts;
    setCurrentTime((t) => {
      const next = Math.min(MOCK_VIDEO_DURATION_SEC, t + deltaSec);
      if (next >= MOCK_VIDEO_DURATION_SEC) {
        stopLoop();
        setPlaying(false);
        onEnded?.();
      }
      return next;
    });
    rafRef.current = requestAnimationFrame(tick);
  };

  const play = () => {
    setPlaying((wasPlaying) => {
      if (!wasPlaying) {
        lastTsRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
      }
      return true;
    });
  };

  const pause = () => {
    if (lockPause) return;
    stopLoop();
    setPlaying(false);
    onPause?.();
  };

  const seek = (seconds: number) => {
    setCurrentTime(Math.max(0, Math.min(MOCK_VIDEO_DURATION_SEC, seconds)));
  };

  useImperativeHandle(ref, () => ({ play, pause, seek, getCurrentTime: () => currentTime }));

  const progress = currentTime / MOCK_VIDEO_DURATION_SEC;

  return (
    <div className="glass-card flex flex-col gap-3 p-4">
      <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--glass-border)] bg-black/30">
        <div className="flex flex-col items-center gap-2 text-[var(--muted-foreground)]">
          <Clapperboard className="h-8 w-8" />
          <span className="text-xs font-semibold uppercase tracking-wide">Placeholder video</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={() => (playing ? pause() : play())}
          disabled={playing && lockPause}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </motion.button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
          {formatTime(currentTime)} / {formatTime(MOCK_VIDEO_DURATION_SEC)}
        </span>
      </div>
      {lockPause && <p className="text-[11px] text-[var(--muted-foreground)]">Pause is locked for this mode.</p>}
    </div>
  );
});

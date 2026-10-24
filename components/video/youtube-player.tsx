"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { loadYouTubeIframeAPI, extractYouTubeId, type YTPlayerInstance } from "@/components/video/youtube";
import type { VideoPlayerHandle } from "@/components/video/types";
import type { LibraryVideo } from "@/lib/match-library";

export type YouTubePlayerProps = {
  video: LibraryVideo;
  lockPause?: boolean;
  onEnded?: () => void;
  onPause?: () => void;
};

/**
 * Real-video path for <VideoPlayer/>, honoring startSec/endSec. `end` in
 * playerVars alone isn't always reliable for firing right at the boundary,
 * so a polling safety net also calls onEnded once getCurrentTime() passes
 * endSec. `lockPause` hides native controls and immediately resumes
 * playback if something still manages to pause it (keyboard, etc.) — there's
 * no official "disable pause" API.
 */
export const YouTubePlayer = forwardRef<VideoPlayerHandle, YouTubePlayerProps>(function YouTubePlayer(
  { video, lockPause, onEnded, onPause },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const endedRef = useRef(false);
  const videoId = extractYouTubeId(video.youtubeUrl);

  useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let cancelled = false;
    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          start: Math.floor(video.startSec),
          end: Math.ceil(video.endSec),
          controls: lockPause ? 0 : 1,
          disablekb: lockPause ? 1 : 0,
          rel: 0,
        },
        events: {
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.PAUSED) {
              if (lockPause) playerRef.current?.playVideo();
              else onPause?.();
            }
            if (event.data === YT.PlayerState.ENDED && !endedRef.current) {
              endedRef.current = true;
              onEnded?.();
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // Re-creating the embed on every onEnded/onPause identity change would
    // restart playback — those are passed fresh closures each render, so
    // only videoId/lockPause (which really do need a new embed) are deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, lockPause, video.startSec, video.endSec]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || endedRef.current) return;
      if (player.getCurrentTime() >= video.endSec) {
        endedRef.current = true;
        player.pauseVideo();
        onEnded?.();
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [video.endSec, onEnded]);

  useImperativeHandle(ref, () => ({
    play: () => playerRef.current?.playVideo(),
    pause: () => {
      if (lockPause) return;
      playerRef.current?.pauseVideo();
    },
    seek: (seconds: number) => playerRef.current?.seekTo(seconds, true),
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
  }));

  if (!videoId) {
    return (
      <div className="glass-card p-6 text-center text-sm text-red-300">Couldn&apos;t read a YouTube video id from this URL.</div>
    );
  }

  return <div ref={containerRef} className="aspect-video w-full overflow-hidden rounded-2xl" />;
});

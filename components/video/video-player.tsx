"use client";

import { forwardRef } from "react";
import { VideoOff } from "lucide-react";
import { MockVideoPlayer } from "@/components/video/mock-video-player";
import { YouTubePlayer } from "@/components/video/youtube-player";
import type { VideoPlayerHandle } from "@/components/video/types";
import type { LibraryVideo } from "@/lib/match-library";

export type VideoPlayerProps = {
  video: LibraryVideo | null;
  /** Team setting (Admin Panel > Match Library) — "Use placeholder video for testing". */
  usePlaceholder: boolean;
  /** Competitive mode (P4): the scout can't pause. */
  lockPause?: boolean;
  onEnded?: () => void;
  onPause?: () => void;
};

/**
 * One interface (VideoPlayerHandle) regardless of which player a match
 * actually gets: the real YouTube embed when `video` is set, MockVideoPlayer
 * when it isn't and the team has placeholder video enabled, or an
 * unavailable notice otherwise — matches the spec ("when off, matches
 * without video are unavailable in practice flows").
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { video, usePlaceholder, lockPause, onEnded, onPause },
  ref
) {
  if (!video) {
    if (!usePlaceholder) {
      return (
        <div className="glass-card flex flex-col items-center gap-2 p-8 text-center text-sm text-[var(--muted-foreground)]">
          <VideoOff className="h-6 w-6" />
          No video for this match yet.
        </div>
      );
    }
    return <MockVideoPlayer ref={ref} lockPause={lockPause} onEnded={onEnded} onPause={onPause} />;
  }
  return <YouTubePlayer ref={ref} video={video} lockPause={lockPause} onEnded={onEnded} onPause={onPause} />;
});

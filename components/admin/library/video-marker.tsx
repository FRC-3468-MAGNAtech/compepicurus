"use client";

import { useMemo, useRef, useState } from "react";
import { Flag, FlagOff, Rewind } from "lucide-react";
import { VideoPlayer } from "@/components/video/video-player";
import type { VideoPlayerHandle } from "@/components/video/types";
import { Button } from "@/components/ui/button";
import { formatTime, parseTimeInput } from "@/lib/library/time";
import { canonicalYouTubeUrl, parseYouTubeUrl } from "@/lib/library/youtube-url";

/**
 * A YouTube preview (the P3 `VideoPlayer`) with **Set start here** / **Set end
 * here** buttons that read the current playback time, so the admin scrubs to
 * the match boundaries instead of typing them. Mount it with `key={videoId}`
 * (or let it remount per link): the embed is created once per video, so
 * setting a time never reloads the player. The preview plays freely — it isn't
 * limited to the start/end window, because the point is finding the window.
 */
export function VideoMarker({
  url,
  startText,
  onSetStart,
  onSetEnd,
}: {
  url: string;
  startText: string;
  onSetStart: (text: string) => void;
  onSetEnd: (text: string) => void;
}) {
  const parsed = useMemo(() => parseYouTubeUrl(url), [url]);
  if (!parsed) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
        Paste a YouTube link above to preview the video and mark the match start and end.
      </p>
    );
  }
  return <MarkerPlayer key={parsed.videoId} videoId={parsed.videoId} initialStart={parseTimeInput(startText) ?? parsed.startSec ?? 0} startText={startText} onSetStart={onSetStart} onSetEnd={onSetEnd} />;
}

function MarkerPlayer({
  videoId,
  initialStart,
  startText,
  onSetStart,
  onSetEnd,
}: {
  videoId: string;
  initialStart: number;
  startText: string;
  onSetStart: (text: string) => void;
  onSetEnd: (text: string) => void;
}) {
  const playerRef = useRef<VideoPlayerHandle>(null);
  // Fixed for this embed's life (the parent remounts per video): a changing window would recreate the player and restart playback.
  const [video] = useState(() => ({ youtubeUrl: canonicalYouTubeUrl(videoId), startSec: Math.floor(initialStart), endSec: 12 * 3600 }));

  const mark = (apply: (text: string) => void) => {
    const t = playerRef.current?.getCurrentTime();
    if (typeof t === "number" && Number.isFinite(t)) apply(formatTime(t));
  };

  return (
    <div className="flex flex-col gap-2">
      <VideoPlayer ref={playerRef} video={video} usePlaceholder={false} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="glass" className="gap-1.5" onClick={() => mark(onSetStart)}>
          <Flag className="h-3.5 w-3.5" /> Set start here
        </Button>
        <Button type="button" size="sm" variant="glass" className="gap-1.5" onClick={() => mark(onSetEnd)}>
          <FlagOff className="h-3.5 w-3.5" /> Set end here
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={() => {
            const start = parseTimeInput(startText);
            if (start !== null) playerRef.current?.seek(start);
          }}
        >
          <Rewind className="h-3.5 w-3.5" /> Go to start
        </Button>
      </div>
    </div>
  );
}

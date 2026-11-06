import { parseTimeInput } from "@/lib/library/time";

// YouTube link parsing for manual library matches (P15). Pure — the player
// components (components/video/youtube.ts) reuse it too, so a link the admin
// helper accepts is always one the player can play.

export type ParsedYouTube = {
  videoId: string;
  /** From a `t=` / `start=` parameter (or `#t=` fragment) when the link carried one. */
  startSec: number | null;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

export const isVideoId = (value: string): boolean => VIDEO_ID.test(value);

/** The one URL shape stored in `libraryMatches.video.youtubeUrl`, so every player and CSV sees the same thing. */
export const canonicalYouTubeUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * Accepts any common YouTube link — `youtu.be/ID`, `youtube.com/watch?v=ID`,
 * `/embed/ID`, `/shorts/ID`, `/live/ID`, `/v/ID`, mobile and nocookie hosts, with or
 * without a scheme, with extra parameters (`si`, `feature`, `list`, …) — or a bare
 * 11-character video id. A start offset in `t`, `start`, `time_continue`, or a
 * `#t=` fragment is returned too (`90`, `90s`, `1m30s`, `1h2m3s`, `1:30`).
 * Returns null for any other host or anything that doesn't carry a valid id.
 */
export function parseYouTubeUrl(input: string): ParsedYouTube | null {
  const text = input.trim();
  if (text === "") return null;
  if (isVideoId(text)) return { videoId: text, startSec: null };

  // Tolerate a pasted link without its scheme ("youtu.be/…", "www.youtube.com/…").
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  let videoId: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = url.pathname.split("/")[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch") videoId = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) videoId = segments[1] ?? null;
  }
  if (!videoId || !isVideoId(videoId)) return null;

  const hashTime = url.hash.match(/[#&]t=([^&]+)/)?.[1] ?? null;
  const rawTime = url.searchParams.get("t") ?? url.searchParams.get("start") ?? url.searchParams.get("time_continue") ?? hashTime;
  return { videoId, startSec: rawTime ? parseTimeInput(rawTime) : null };
}

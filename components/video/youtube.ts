"use client";

// Minimal local typings for the bits of the YouTube IFrame API this app
// uses — not worth adding a dependency for. See
// https://developers.google.com/youtube/iframe_api_reference.
export type YTPlayerInstance = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  destroy(): void;
};

export type YTPlayerOptions = {
  videoId: string;
  playerVars?: Record<string, number | string>;
  events?: {
    onReady?: (event: { target: YTPlayerInstance }) => void;
    onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
  };
};

export type YTNamespace = {
  Player: new (el: string | HTMLElement, options: YTPlayerOptions) => YTPlayerInstance;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the YouTube IFrame API script once (memoized across every player instance on the page) and resolves with the global `YT` namespace. */
export function loadYouTubeIframeAPI(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** Handles watch?v=, youtu.be/, and /embed/ URL shapes. Returns null for anything else. */
export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1) || null;
    const vParam = parsed.searchParams.get("v");
    if (vParam) return vParam;
    const embedMatch = parsed.pathname.match(/\/embed\/([^/?]+)/);
    if (embedMatch) return embedMatch[1];
    return null;
  } catch {
    return null;
  }
}

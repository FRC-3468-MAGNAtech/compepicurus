"use client";

import { parseYouTubeUrl } from "@/lib/library/youtube-url";

// Minimal local typings for the bits of the YouTube IFrame API this app
// uses — not worth adding a dependency for. See
// https://developers.google.com/youtube/iframe_api_reference.
export type YTPlayerInstance = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
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

/** Any link form the admin helper accepts (watch, youtu.be, embed, shorts, live, with extra params) — see lib/library/youtube-url.ts. Returns null for anything else. */
export function extractYouTubeId(url: string): string | null {
  return parseYouTubeUrl(url)?.videoId ?? null;
}

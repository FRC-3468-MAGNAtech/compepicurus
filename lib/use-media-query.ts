"use client";

import { useSyncExternalStore } from "react";

/** A CSS media query as a boolean (`false` on the server and until the browser answers, so the desktop layout is never assumed on a phone). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "./types";

type Status = "loading" | "success" | "empty" | "error";

type QueryState<T> = {
  status: Status;
  data: T | null;
  error: { message: string } | null;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

// Session-level cache shared by every useFtcQuery call in the tab: once an
// event's teams/matches have been fetched, navigating between pages (Event
// Selection, and later the Scout Form) reads from here instead of re-hitting
// the server action, until the entry expires or refetch() is called.
const cache = new Map<string, { data: unknown; expires: number }>();

function isEmptyResult(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0;
}

/**
 * key: a stable cache key (e.g. `events:2026`, `teams:FTCCMP1:2026`). Pass
 * null to skip fetching entirely (e.g. while a required param isn't ready yet).
 */
export function useFtcQuery<T>(
  key: string | null,
  fetcher: () => Promise<ActionResult<T>>
): QueryState<T> & { refetch: () => void } {
  const [state, setState] = useState<QueryState<T>>({ status: "loading", data: null, error: null });
  const fetcherRef = useRef(fetcher);
  const requestKeyRef = useRef<string | null>(null);

  // Keep the latest fetcher without calling it on every render — refs must be
  // written outside of render, so this syncs it in an effect instead.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(
    (bypassCache: boolean) => {
      if (!key) {
        setState({ status: "loading", data: null, error: null });
        return;
      }

      if (!bypassCache) {
        const cached = cache.get(key);
        if (cached && cached.expires > Date.now()) {
          const data = cached.data as T;
          setState({ status: isEmptyResult(data) ? "empty" : "success", data, error: null });
          return;
        }
      }

      requestKeyRef.current = key;
      setState((s) => ({ ...s, status: "loading" }));
      fetcherRef.current().then((result) => {
        // If `key` has changed since this request started, a newer request
        // owns the state now — drop this stale response.
        if (requestKeyRef.current !== key) return;
        if (result.ok) {
          cache.set(key, { data: result.data, expires: Date.now() + CACHE_TTL_MS });
          setState({ status: isEmptyResult(result.data) ? "empty" : "success", data: result.data, error: null });
        } else {
          setState({ status: "error", data: null, error: result.error });
        }
      });
    },
    [key]
  );

  useEffect(() => {
    // Deliberate: this is the data-fetching effect itself — `key` changing
    // (new season, new event) should kick off a fetch and move the hook into
    // its loading state, same as React's own documented data-fetching pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
  }, [load]);

  return { ...state, refetch: () => load(true) };
}

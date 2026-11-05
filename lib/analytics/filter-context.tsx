"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  mergeFilterParams,
  parseFilters,
  type AnalyticsFilters,
} from "@/lib/analytics/filters";

// The Analytics filter state (P10). The URL query string is the single source
// of truth — the provider parses it on every render and writes it with the
// History API — so filters are shareable, the back button restores them, and
// they survive moving between subpages as long as links carry the query
// (see AnalyticsLink and AnalyticsTabs). The provider lives in the Analytics
// layout, which Next keeps mounted across subpages.

type FilterContextValue = {
  filters: AnalyticsFilters;
  /**
   * Merge a patch into the filters and write the URL. `push` (default) adds a
   * history entry so Back undoes the change; `replace` is for continuous input
   * like typing a custom accuracy.
   */
  setFilters: (patch: Partial<AnalyticsFilters>, mode?: "push" | "replace") => void;
  resetFilters: () => void;
  /** `?game=…&acc=…` for the current filters, or `""` at defaults — append to a path to carry the filters along. */
  query: string;
  /** True while a page has asked for single-event mode (see `useSingleEventMode`). */
  singleEvent: boolean;
  /** …and wants it even while Practice is on (the Pick List: its official data is always one real event). */
  singleEventInPractice: boolean;
  setSingleEvent: (value: boolean, includePractice?: boolean) => void;
};

const FilterContext = createContext<FilterContextValue | null>(null);

export function AnalyticsFilterProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [single, setSingle] = useState({ on: false, includePractice: false });
  const setSingleEvent = useCallback((value: boolean, includePractice: boolean = false) => setSingle({ on: value, includePractice }), []);

  const filters = useMemo(() => parseFilters(new URLSearchParams(queryString)), [queryString]);

  const setFilters = useCallback(
    (patch: Partial<AnalyticsFilters>, mode: "push" | "replace" = "push") => {
      const next: AnalyticsFilters = { ...filters, ...patch };
      const params = mergeFilterParams(queryString, next).toString();
      const url = `${pathname}${params ? `?${params}` : ""}`;
      // Next's router listens to these and refreshes useSearchParams().
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [filters, pathname, queryString]
  );

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters]);

  const value = useMemo<FilterContextValue>(
    () => ({
      filters,
      setFilters,
      resetFilters,
      query: filtersToQuery(filters),
      singleEvent: single.on,
      singleEventInPractice: single.on && single.includePractice,
      setSingleEvent,
    }),
    [filters, setFilters, resetFilters, single, setSingleEvent]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useAnalyticsFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useAnalyticsFilters must be used inside <AnalyticsFilterProvider> (the Analytics layout mounts it).");
  return ctx;
}

/** `href` with the current filters appended — for any link between Analytics pages. */
export function useAnalyticsHref(): (path: string, extra?: Record<string, string>) => string {
  const { query } = useAnalyticsFilters();
  return useCallback(
    (path: string, extra?: Record<string, string>) => {
      const params = new URLSearchParams(query.replace(/^\?/, ""));
      for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
      const qs = params.toString();
      return qs ? `${path}?${qs}` : path;
    },
    [query]
  );
}

/**
 * Call from a page that can only show one event at a time (e.g. Match Scout
 * Analytics, whose Import/Recalculate act on a single event): the shared
 * filter bar's Event control becomes a single select for as long as the page
 * is mounted. By default that only applies to real-event data; pass
 * `includePractice` for a page that needs one event even in Practice mode
 * (the Pick List).
 */
export function useSingleEventMode(enabled: boolean = true, includePractice: boolean = false) {
  const { setSingleEvent } = useAnalyticsFilters();
  useEffect(() => {
    // Registers/unregisters this page's request with the layout-level filter bar.
    setSingleEvent(enabled, includePractice);
    return () => setSingleEvent(false);
  }, [enabled, includePractice, setSingleEvent]);
}

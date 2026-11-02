"use client";

import { Suspense } from "react";
import { AnalyticsTabs } from "@/components/layout/analytics-tabs";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { AnalyticsFilterProvider } from "@/lib/analytics/filter-context";
import { AnalyticsDataProvider } from "@/lib/analytics/data-context";

/**
 * Everything the Analytics layout shares across subpages (P10): the filter
 * state (URL-backed), the single realtime data layer, the tabs, and the one
 * filter bar. Next keeps the layout mounted while the user moves between
 * subpages, so none of this re-subscribes or resets on navigation.
 *
 * `useSearchParams()` (the filter state) has to sit inside a Suspense
 * boundary; the fallback reserves roughly the filter bar's height so nothing
 * below it shifts when it resolves.
 */
export function AnalyticsShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AnalyticsFilterProvider>
        <AnalyticsDataProvider>
          <AnalyticsTabs />
          <div className="mb-4">
            <AnalyticsFilterBar />
          </div>
          <div>{children}</div>
        </AnalyticsDataProvider>
      </AnalyticsFilterProvider>
    </Suspense>
  );
}

function ShellFallback() {
  return (
    <>
      <div className="glass-pill mb-6 h-[52px] w-full animate-pulse" />
      <div className="glass-card mb-4 h-[120px] animate-pulse" />
    </>
  );
}

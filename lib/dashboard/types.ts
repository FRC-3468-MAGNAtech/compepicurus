import type { ReactNode } from "react";

/** How many grid columns a widget takes: one cell, two, or the full row. */
export type WidgetSize = "small" | "medium" | "wide";

/**
 * One dashboard widget (P13). The registry (`components/dashboard/registry.tsx`)
 * maps each role to an ordered list of these — adding a widget later is one
 * entry. `render` returns the widget's element; the widget reads its own data
 * from the shared `useDashboard()` context, so a registry entry never fetches
 * anything.
 */
export type DashboardWidget = {
  /** Unique within a role; also the React key. */
  id: string;
  /** Shown in the card header — and in the error state, if the widget fails to render. */
  title: string;
  size: WidgetSize;
  render: () => ReactNode;
};

export type WidgetStatus = "loading" | "empty" | "error" | "ready";

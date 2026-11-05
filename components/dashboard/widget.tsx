"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";
import { Shimmer } from "@/components/ui/shimmer";
import type { WidgetSize, WidgetStatus } from "@/lib/dashboard/types";
import { cardEntranceVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Grid cells each size takes (the dashboard grid is 1 column on phones, 2 on tablets, 4 on wide screens). */
export const WIDGET_GRID_CLASS: Record<WidgetSize, string> = {
  small: "",
  medium: "sm:col-span-2",
  wide: "sm:col-span-2 xl:col-span-4",
};

// Reserved heights, so a widget's skeleton, empty, error, and loaded states all
// occupy the same space and nothing shifts when data arrives.
const MIN_HEIGHT: Record<WidgetSize, string> = {
  small: "min-h-[176px]",
  medium: "min-h-[232px]",
  wide: "min-h-[232px]",
};

/**
 * The compact glass card every dashboard widget is built from: a title, one key
 * number or short list, a small context line, and a footer link to the page
 * with more detail. It owns the four states — `loading` (a skeleton the same
 * size as the content), `empty`, `error`, and `ready` — so every widget handles
 * them the same way.
 */
export function Widget({
  title,
  icon: Icon,
  size,
  status,
  href,
  linkLabel = "Details",
  emptyText = "Nothing to show yet.",
  errorText = "Couldn't load this right now.",
  headerRight,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  size: WidgetSize;
  status: WidgetStatus;
  /** The detail page this widget taps through to. */
  href?: string;
  linkLabel?: string;
  emptyText?: ReactNode;
  errorText?: ReactNode;
  headerRight?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <motion.section
      variants={cardEntranceVariants}
      initial="hidden"
      animate="show"
      aria-busy={status === "loading"}
      className={cn("glass-card glow-ring flex h-full flex-col gap-3 p-4", MIN_HEIGHT[size])}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--color-primary)" }} />}
          <span className="truncate">{title}</span>
        </h3>
        {headerRight}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {status === "loading" ? (
          <WidgetSkeleton size={size} />
        ) : status === "error" ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-amber-300">
            <AlertTriangle className="h-5 w-5" />
            <span>{errorText}</span>
          </div>
        ) : status === "empty" ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-[var(--muted-foreground)]">{emptyText}</div>
        ) : (
          children
        )}
      </div>

      {href && (
        <Link
          href={href}
          className="mt-auto flex min-h-9 items-center gap-1 self-start rounded-full text-xs font-medium text-[var(--muted-foreground)] outline-none transition-colors hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
        >
          {linkLabel} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </motion.section>
  );
}

function WidgetSkeleton({ size }: { size: WidgetSize }) {
  return (
    <div className="flex flex-1 flex-col gap-2.5" aria-hidden>
      <Shimmer className="h-8 w-1/2" />
      <Shimmer className="h-3 w-3/4" />
      {size !== "small" && <Shimmer className="h-12 w-full" />}
      {size === "wide" && <Shimmer className="h-12 w-full" />}
    </div>
  );
}

/**
 * Catches a widget that throws while rendering and shows its error state
 * instead of taking the whole dashboard down. One bad widget (or one bad doc it
 * choked on) leaves the other cards untouched.
 */
export class WidgetBoundary extends Component<{ title: string; size: WidgetSize; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Dashboard widget "${this.props.title}" failed:`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Widget title={this.props.title} size={this.props.size} status="error" errorText="This card hit a problem." headerRight={
        <button type="button" onClick={() => this.setState({ failed: false })} className="rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]">
          Retry
        </button>
      } />
    );
  }
}

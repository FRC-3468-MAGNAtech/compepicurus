"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { cn } from "@/lib/utils";

export type TeamTableSort = { key: string; direction: "asc" | "desc" };

export type TeamTableColumn<T> = {
  key: string;
  label: string;
  /** px — also used to lay out the sticky column offsets. */
  width: number;
  align?: "left" | "right";
  /** The first column should be sticky: it stays put while the rest scroll sideways. */
  sticky?: boolean;
  /** Provide to make the column sortable. `null` always sorts last, in either direction. */
  sortValue?: (row: T) => number | string | null;
  render: (row: T) => React.ReactNode;
};

const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 56;

/**
 * Virtualized table for Team Averages and Rankings: sticky header, sticky
 * team column, zebra rows with a theme-glow hover, and each row a link to the
 * team's profile (carrying the Analytics filters). Sorting is applied here;
 * the page owns the sort state.
 */
export function TeamTable<T>({
  rows,
  columns,
  getKey,
  getHref,
  sort,
  onSortChange,
  rowClassName,
  empty,
}: {
  rows: T[];
  columns: TeamTableColumn<T>[];
  getKey: (row: T) => string | number;
  /** Where clicking a row goes (the Team Profile). */
  getHref: (row: T) => string;
  sort: TeamTableSort;
  onSortChange: (sort: TeamTableSort) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.direction === "asc" ? 1 : -1;
    // Stable: ties keep the caller's order (e.g. team number).
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      return (av - bv) * dir;
    });
  }, [rows, columns, sort]);

  const { leftOffsets, totalWidth } = useMemo(() => {
    let cumulative = 0;
    const offsets = columns.map((c) => {
      const left = c.sticky ? cumulative : 0;
      if (c.sticky) cumulative += c.width;
      return left;
    });
    return { leftOffsets: offsets, totalWidth: columns.reduce((s, c) => s + c.width, 0) };
  }, [columns]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (rows.length === 0) {
    return <div className="glass-card p-12 text-center text-sm text-[var(--muted-foreground)]">{empty}</div>;
  }

  const clickSort = (col: TeamTableColumn<T>) => {
    if (!col.sortValue) return;
    // First click on a column sorts it best-first (descending) for numbers, A-Z for text.
    onSortChange(
      sort.key === col.key
        ? { key: col.key, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { key: col.key, direction: col.key === "team" ? "asc" : "desc" }
    );
  };

  return (
    <div ref={scrollRef} className="glass-card relative max-h-[70vh] overflow-auto rounded-2xl" style={{ scrollbarGutter: "stable" }}>
      <div style={{ width: totalWidth, minWidth: "100%", position: "relative" }}>
        <div role="row" className="sticky top-0 z-30 flex" style={{ height: HEADER_HEIGHT }}>
          {columns.map((col, i) => {
            const active = sort.key === col.key;
            const Icon = !col.sortValue ? null : active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
            return (
              <div
                key={col.key}
                role="columnheader"
                aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : col.sortValue ? "none" : undefined}
                className={cn(
                  "glass-overlay flex shrink-0 items-center border-b border-[var(--glass-border)] px-3 text-xs font-semibold uppercase tracking-wide",
                  col.sticky && "sticky z-40",
                  col.align === "right" ? "justify-end" : "justify-start"
                )}
                style={{ width: col.width, left: col.sticky ? leftOffsets[i] : undefined }}
              >
                {col.sortValue ? (
                  <button
                    type="button"
                    onClick={() => clickSort(col)}
                    className={cn("flex min-h-9 items-center gap-1.5 whitespace-nowrap outline-none transition-colors hover:text-[var(--foreground)] focus-visible:text-[var(--foreground)]", !active && "text-[var(--muted-foreground)]")}
                  >
                    {col.label}
                    {Icon && <Icon className={cn("h-3 w-3", !active && "opacity-50")} />}
                  </button>
                ) : (
                  <span className="whitespace-nowrap text-[var(--muted-foreground)]">{col.label}</span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vr) => {
            const row = sorted[vr.index];
            return (
              <AnalyticsLink
                key={getKey(row)}
                href={getHref(row)}
                role="row"
                data-index={vr.index}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: ROW_HEIGHT, transform: `translateY(${vr.start}px)` }}
                className={cn(
                  "group/row flex border-b border-[var(--glass-border)] outline-none transition-[background-color,box-shadow] duration-150",
                  vr.index % 2 === 1 && "bg-white/[0.035]",
                  "hover:bg-white/10 hover:shadow-[inset_0_0_0_1px_rgba(var(--glow),0.45)] focus-visible:bg-white/10 focus-visible:shadow-[inset_0_0_0_2px_rgba(var(--glow),0.6)]",
                  rowClassName?.(row)
                )}
              >
                {columns.map((col, i) => (
                  <div
                    key={col.key}
                    role="cell"
                    className={cn(
                      "flex shrink-0 items-center px-3 text-sm",
                      col.sticky && "glass-overlay sticky z-20",
                      col.align === "right" ? "justify-end text-right" : "justify-start"
                    )}
                    style={{ width: col.width, left: col.sticky ? leftOffsets[i] : undefined }}
                  >
                    {col.render(row)}
                  </div>
                ))}
              </AnalyticsLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Settings2, Trash2 } from "lucide-react";
import type { AnalyticsColumn, GameSchema } from "@/lib/analytics/game-schema";
import type { AccuracyStatus, ScoutEntry } from "@/lib/scout-entries";
import { cn } from "@/lib/utils";
import { CommentCell } from "@/components/analytics/comment-cell";
import { AccuracyCell } from "@/components/analytics/accuracy-cell";
import { Badge } from "@/components/ui/badge";

export type SortState = { key: string; direction: "asc" | "desc" };

const HEADER_ROW_HEIGHT = 32;
const ROW_MIN_HEIGHT = 52;

const SCRIPT_STATUS_LABEL: Record<AccuracyStatus, string> = {
  complete: "Complete",
  "needs-robots": "Needs Robots",
  "awaiting-results": "Awaiting Results",
  "not-applicable": "-",
};

function groupConsecutive(columns: AnalyticsColumn[], keyFn: (c: AnalyticsColumn) => string) {
  const groups: { key: string; span: number; startIndex: number }[] = [];
  columns.forEach((c, i) => {
    const k = keyFn(c);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.span++;
    else groups.push({ key: k, span: 1, startIndex: i });
  });
  return groups;
}

export function AnalyticsDataTable({
  schema,
  entries,
  hideNames,
  nameMap,
  autoExpandNotes,
  sort,
  onSortChange,
  onOpenConfig,
  onDelete,
}: {
  schema: GameSchema;
  entries: ScoutEntry[];
  hideNames: boolean;
  nameMap: Map<string, string>;
  autoExpandNotes: boolean;
  sort: SortState;
  onSortChange: (s: SortState) => void;
  onOpenConfig: (entry: ScoutEntry) => void;
  onDelete: (entry: ScoutEntry) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = schema.columns;

  const { leftOffsets, totalWidth } = useMemo(() => {
    let cumulative = 0;
    const offsets = columns.map((c) => {
      const left = c.sticky ? cumulative : 0;
      if (c.sticky) cumulative += c.width;
      return left;
    });
    return { leftOffsets: offsets, totalWidth: columns.reduce((sum, c) => sum + c.width, 0) };
  }, [columns]);

  const phaseGroups = useMemo(() => groupConsecutive(columns, (c) => c.phase), [columns]);
  const categoryGroups = useMemo(() => groupConsecutive(columns, (c) => `${c.phase}::${c.category}`), [columns]);

  const groupBox = (group: { startIndex: number; span: number }) => {
    const left = leftOffsets[group.startIndex];
    const width = columns.slice(group.startIndex, group.startIndex + group.span).reduce((s, c) => s + c.width, 0);
    const sticky = columns.slice(group.startIndex, group.startIndex + group.span).every((c) => c.sticky);
    return { left, width, sticky };
  };

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_MIN_HEIGHT,
    overscan: 8,
  });

  if (entries.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center gap-2 p-12 text-center text-sm text-[var(--muted-foreground)]">
        No entries match the current search.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="glass-card relative max-h-[70vh] overflow-auto rounded-2xl"
      style={{ scrollbarGutter: "stable" }}
    >
      <div style={{ width: totalWidth, position: "relative" }}>
        {/* 3-tier sticky header */}
        <div className="sticky top-0 z-30">
          <div className="flex" style={{ height: HEADER_ROW_HEIGHT }}>
            {phaseGroups.map((g) => {
              const box = groupBox(g);
              return (
                <HeaderCell key={`phase-${g.startIndex}`} {...box} top={0}>
                  {g.key}
                </HeaderCell>
              );
            })}
          </div>
          <div className="flex" style={{ height: HEADER_ROW_HEIGHT }}>
            {categoryGroups.map((g) => {
              const box = groupBox(g);
              return (
                <HeaderCell key={`cat-${g.startIndex}`} {...box} top={HEADER_ROW_HEIGHT} muted>
                  {columns[g.startIndex].category}
                </HeaderCell>
              );
            })}
          </div>
          <div className="flex" style={{ height: HEADER_ROW_HEIGHT }}>
            {columns.map((col, i) => (
              <div
                key={col.key}
                className={cn(
                  "glass-overlay flex shrink-0 items-center border-b border-r border-[var(--glass-border)] px-3",
                  col.sticky && "sticky"
                )}
                style={{
                  width: col.width,
                  left: col.sticky ? leftOffsets[i] : undefined,
                  top: col.sticky ? HEADER_ROW_HEIGHT * 2 : undefined,
                  zIndex: col.sticky ? 40 : 30,
                  position: col.sticky ? "sticky" : "relative",
                }}
              >
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() =>
                      onSortChange({
                        key: col.key,
                        direction: sort.key === col.key && sort.direction === "asc" ? "desc" : "asc",
                      })
                    }
                    className="flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    {col.label}
                    {sort.key === col.key ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                ) : (
                  <span className="text-xs font-medium text-[var(--muted-foreground)]">{col.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Virtualized body */}
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index];
            return (
              <div
                key={entry.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                className={cn(
                  "flex border-b border-[var(--glass-border)] transition-colors hover:bg-white/5",
                  entry.excluded && "opacity-60"
                )}
              >
                {columns.map((col, i) => (
                  <div
                    key={col.key}
                    className={cn(
                      "flex shrink-0 items-center px-3 py-2.5 text-sm",
                      col.sticky && "glass-overlay sticky z-20",
                      entry.excluded && col.type !== "actions" && "line-through"
                    )}
                    style={{ width: col.width, left: col.sticky ? leftOffsets[i] : undefined, minHeight: ROW_MIN_HEIGHT }}
                  >
                    <Cell
                      col={col}
                      entry={entry}
                      hideNames={hideNames}
                      nameMap={nameMap}
                      autoExpandNotes={autoExpandNotes}
                      onOpenConfig={onOpenConfig}
                      onDelete={onDelete}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HeaderCell({
  left,
  width,
  sticky,
  top,
  muted,
  children,
}: {
  left: number;
  width: number;
  sticky: boolean;
  top: number;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "glass-overlay flex shrink-0 items-center border-b border-r border-[var(--glass-border)] px-3 text-xs font-semibold uppercase tracking-wide",
        muted && "font-medium normal-case tracking-normal text-[var(--muted-foreground)]"
      )}
      style={{ width, left: sticky ? left : undefined, top: sticky ? top : undefined, zIndex: sticky ? 40 : 30, position: sticky ? "sticky" : "relative" }}
    >
      {children}
    </div>
  );
}

function Cell({
  col,
  entry,
  hideNames,
  nameMap,
  autoExpandNotes,
  onOpenConfig,
  onDelete,
}: {
  col: AnalyticsColumn;
  entry: ScoutEntry;
  hideNames: boolean;
  nameMap: Map<string, string>;
  autoExpandNotes: boolean;
  onOpenConfig: (entry: ScoutEntry) => void;
  onDelete: (entry: ScoutEntry) => void;
}) {
  switch (col.type) {
    case "scoutName": {
      const real = col.getValue(entry) as string;
      return <span>{hideNames ? nameMap.get(real) ?? real : real}</span>;
    }
    case "boolean": {
      const value = col.getValue(entry) as boolean;
      return (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            value ? "bg-emerald-500/15 text-emerald-300" : "text-[var(--muted-foreground)]"
          )}
        >
          {value ? "Y" : "N"}
        </span>
      );
    }
    case "count":
    case "score": {
      const value = col.getValue(entry) as number;
      return <span className={value === 0 ? "text-[var(--muted-foreground)]" : "font-medium"}>{value}</span>;
    }
    case "comments":
      return <CommentCell text={entry.comments} forceExpanded={autoExpandNotes} />;
    case "accuracy":
      return <AccuracyCell accuracy={entry.accuracy} />;
    case "scriptStatus":
      return <span className="text-[var(--muted-foreground)]">{SCRIPT_STATUS_LABEL[entry.accuracy?.status ?? "not-applicable"]}</span>;
    case "text":
      return <span className="font-mono text-xs text-[var(--muted-foreground)]">{String(col.getValue(entry) ?? "")}</span>;
    case "badge":
      return <Badge className={cn("text-[10px]", col.getBadgeClassName?.(entry))}>{String(col.getValue(entry) ?? "")}</Badge>;
    case "actions": {
      const activeFlagCount = entry.autoFlags.filter((f) => !f.dismissed).length + entry.manualFlags.length;
      const hasManual = entry.manualFlags.length > 0;
      const hasAuto = entry.autoFlags.some((f) => !f.dismissed);
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenConfig(entry)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              hasManual
                ? "border-red-400/40 bg-red-500/10 text-red-200"
                : hasAuto
                  ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                  : "border-[var(--glass-border)] text-[var(--muted-foreground)] hover:bg-white/8"
            )}
          >
            <Settings2 className="h-3.5 w-3.5" /> Config{activeFlagCount > 0 ? ` (${activeFlagCount})` : ""}
          </button>
          <button
            type="button"
            onClick={() => onDelete(entry)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-red-300 hover:bg-red-500/15"
            aria-label="Delete entry"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }
    default:
      return <span>{String(col.getValue(entry) ?? "")}</span>;
  }
}

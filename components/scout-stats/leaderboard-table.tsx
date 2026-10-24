"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getRole } from "@/lib/roles";
import { getPercentColor } from "@/lib/accuracy/engine";
import type { ScoutCategory, ScoutLeaderboardRow } from "@/lib/scout-stats/types";
import { cn } from "@/lib/utils";

type SortColumn = "rank" | "name" | "role" | "accuracy" | "status" | "sessions" | "entries";
type SortState = { column: SortColumn; direction: "asc" | "desc" };

function SortHeader({
  column,
  sort,
  onToggle,
  children,
}: {
  column: SortColumn;
  sort: SortState;
  onToggle: (column: SortColumn) => void;
  children: React.ReactNode;
}) {
  return (
    <TH>
      <button type="button" onClick={() => onToggle(column)} className="flex items-center gap-1 hover:text-[var(--foreground)]">
        {children}
        {sort.column === column ? (
          sort.direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TH>
  );
}

export function LeaderboardTable({
  category,
  rows,
  onViewDetails,
}: {
  category: ScoutCategory;
  rows: ScoutLeaderboardRow[];
  onViewDetails: (uid: string) => void;
}) {
  const [sort, setSort] = useState<SortState>({ column: "rank", direction: "asc" });

  const sorted = useMemo(() => {
    const withValue = (row: ScoutLeaderboardRow): number | string | null => {
      switch (sort.column) {
        case "rank":
          return row.rank;
        case "name":
          return row.name.toLowerCase();
        case "role":
          return getRole(row.primaryRole).label.toLowerCase();
        case "accuracy":
          return row.accuracy;
        case "status":
          return row.status?.id ?? null;
        case "sessions":
          return row.sessionsOrForms;
        case "entries":
          return row.totalEntries;
      }
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = withValue(a);
      const bv = withValue(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const toggleSort = (column: SortColumn) => {
    setSort((prev) => (prev.column === column ? { column, direction: prev.direction === "asc" ? "desc" : "asc" } : { column, direction: "asc" }));
  };

  if (rows.length === 0) {
    return <p className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">No scouts match the current filters.</p>;
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Rank</TH>
          <SortHeader column="name" sort={sort} onToggle={toggleSort}>Scout</SortHeader>
          <SortHeader column="role" sort={sort} onToggle={toggleSort}>Role</SortHeader>
          <SortHeader column="accuracy" sort={sort} onToggle={toggleSort}>Accuracy</SortHeader>
          <SortHeader column="status" sort={sort} onToggle={toggleSort}>Status</SortHeader>
          <SortHeader column="sessions" sort={sort} onToggle={toggleSort}>{category === "real-event" ? "Forms" : "Sessions"}</SortHeader>
          {category !== "real-event" && (
            <SortHeader column="entries" sort={sort} onToggle={toggleSort}>
              Entries
            </SortHeader>
          )}
          <TH />
        </TR>
      </THead>
      <TBody>
        {sorted.map((row) => {
          const role = getRole(row.primaryRole);
          return (
            <TR key={row.uid}>
              <TD className="font-mono text-sm">{row.rank ?? "?"}</TD>
              <TD>
                <div className="flex items-center gap-2.5">
                  <Avatar name={row.name} size="sm" />
                  <span className="font-medium">{row.name}</span>
                </div>
              </TD>
              <TD>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", role.className)}>{role.label}</span>
              </TD>
              <TD>
                {row.accuracy === null ? (
                  <span className="text-[var(--muted-foreground)]">?</span>
                ) : (
                  <span className={cn("font-semibold tabular-nums", getPercentColor(row.accuracy))}>{Math.round(row.accuracy)}%</span>
                )}
              </TD>
              <TD>
                {row.status ? (
                  <Badge className={row.status.badgeClassName}>{row.status.label}</Badge>
                ) : (
                  <span className="text-[var(--muted-foreground)]">?</span>
                )}
              </TD>
              <TD>{row.sessionsOrForms}</TD>
              {category !== "real-event" && <TD>{row.totalEntries ?? 0}</TD>}
              <TD>
                <Button variant="ghost" size="sm" onClick={() => onViewDetails(row.uid)}>
                  View Details
                </Button>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

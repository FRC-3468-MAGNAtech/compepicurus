"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GlassSkeletonCard } from "@/components/ui/glass-skeleton";
import { Button } from "@/components/ui/button";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import { getTeamsForEvent } from "@/lib/ftc/actions";
import type { FtcTeam } from "@/lib/ftc/types";
import { cn } from "@/lib/utils";

export function TeamPickerDialog({
  open,
  onOpenChange,
  eventCode,
  season,
  priorityTeamNumbers,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventCode: string;
  season: number;
  priorityTeamNumbers?: number[];
  onSelect: (teamNumber: number) => void;
}) {
  const [search, setSearch] = useState("");
  const teamsQuery = useFtcQuery(`teams:${eventCode}:${season}`, () => getTeamsForEvent(eventCode, season));

  const teams = useMemo(() => {
    const list = teamsQuery.data ?? [];
    const prioritized = new Set(priorityTeamNumbers ?? []);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((t) => String(t.teamNumber).includes(q) || t.nameShort.toLowerCase().includes(q))
      : list;
    return [...filtered].sort((a, b) => {
      const aP = prioritized.has(a.teamNumber) ? 0 : 1;
      const bP = prioritized.has(b.teamNumber) ? 0 : 1;
      return aP !== bP ? aP - bP : a.teamNumber - b.teamNumber;
    });
  }, [teamsQuery.data, search, priorityTeamNumbers]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogTitle>Pick a team</DialogTitle>
        <DialogDescription>Teams registered for this event.</DialogDescription>
        <div className="mt-4 flex flex-col gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number or name..."
            autoFocus
          />
          <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
            {teamsQuery.status === "loading" && (
              <>
                <GlassSkeletonCard className="h-16 p-3.5" />
                <GlassSkeletonCard className="h-16 p-3.5" />
                <GlassSkeletonCard className="h-16 p-3.5" />
              </>
            )}
            {teamsQuery.status === "error" && (
              <div className="glass-card flex flex-col items-center gap-2 p-6 text-center text-sm text-[var(--muted-foreground)]">
                Couldn&apos;t load teams &mdash; {teamsQuery.error?.message}
                <Button variant="glass" size="sm" onClick={teamsQuery.refetch}>
                  Retry
                </Button>
              </div>
            )}
            {teamsQuery.status === "empty" && (
              <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
                No teams found for this event yet.
              </div>
            )}
            {teamsQuery.status === "success" && teams.length === 0 && (
              <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
                No teams match &ldquo;{search}&rdquo;.
              </div>
            )}
            {teamsQuery.status === "success" &&
              teams.map((team) => (
                <TeamRow
                  key={team.teamNumber}
                  team={team}
                  prioritized={priorityTeamNumbers?.includes(team.teamNumber) ?? false}
                  onClick={() => {
                    onSelect(team.teamNumber);
                    onOpenChange(false);
                  }}
                />
              ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamRow({ team, prioritized, onClick }: { team: FtcTeam; prioritized: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass-card flex items-center justify-between gap-3 p-3.5 text-left transition-colors hover:bg-white/8",
        prioritized && "ring-1 ring-[rgba(var(--glow),0.5)]"
      )}
    >
      <div className="min-w-0">
        <div className="font-semibold">{team.teamNumber}</div>
        <div className="truncate text-xs text-[var(--muted-foreground)]">{team.nameShort}</div>
      </div>
      {prioritized && <Badge variant="accent">In match</Badge>}
    </button>
  );
}

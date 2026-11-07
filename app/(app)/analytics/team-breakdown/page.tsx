"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { PhaseMiniBars, type PhaseValues } from "@/components/analytics/phase-bars";
import { LowSampleBadge, OurTeamTag } from "@/components/analytics/team-bits";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { cn } from "@/lib/utils";
import { ReliabilityPill } from "@/components/analytics/reliability-pill";
import { useTeamStats } from "@/lib/analytics/data-context";
import {
  TEAM_SORTS,
  buildKeyStats,
  sortTeams,
  teamMatchesSearch,
  type TeamSortKey,
} from "@/lib/analytics/team-card";
import { DEFAULT_MIN_ENTRIES, type TeamStats } from "@/lib/analytics/team-stats";
import { cardEntranceVariants } from "@/lib/motion";
import type { ScoutFormSchema } from "@/lib/scout-form/schema";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

export default function TeamBreakdownPage() {
  const { teamStats, loaded, schema } = useTeamStats();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TeamSortKey>("avgTotal");

  // Each phase bar is scaled to the best team's average for that phase, so the cards compare with each other.
  const phaseMax = useMemo<PhaseValues>(
    () => ({
      auto: Math.max(0, ...teamStats.map((t) => t.avgAuto)),
      teleop: Math.max(0, ...teamStats.map((t) => t.avgTeleop)),
      endgame: Math.max(0, ...teamStats.map((t) => t.avgEndgame)),
    }),
    [teamStats]
  );

  const visible = useMemo(() => sortTeams(teamStats.filter((t) => teamMatchesSearch(t, search)), sort), [teamStats, search, sort]);
  const sortLabel = TEAM_SORTS.find((s) => s.id === sort)!.label;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Team Breakdown</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Every scouted team at a glance. Tap a card for the full profile; Team Averages has the same data as a table.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
          <div className="relative min-w-52 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team number or name..." className="pl-10" aria-label="Search teams" />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as TeamSortKey)}>
            <SelectTrigger className="w-48" aria-label="Sort teams">
              <SelectValue>Sort: {sortLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TEAM_SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!loaded ? (
        // Same grid and about the same height as a card, so nothing shifts when the data arrives.
        <div className={GRID} aria-busy>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card h-[330px] animate-pulse" />
          ))}
        </div>
      ) : teamStats.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No scouted data with the current filters. Try widening the Event, Accuracy, or Practice settings above.
        </GlassPanel>
      ) : visible.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">No teams match &ldquo;{search}&rdquo;.</GlassPanel>
      ) : (
        <>
          <p className="text-xs tabular-nums text-[var(--muted-foreground)]">
            {visible.length === teamStats.length ? `${teamStats.length} teams` : `${visible.length} of ${teamStats.length} teams`}
          </p>
          <div className={GRID}>
            {visible.map((team, i) => (
              <motion.div key={team.teamNumber} variants={cardEntranceVariants} initial="hidden" animate="show" custom={Math.min(i, 8)}>
                <TeamCard team={team} schema={schema} phaseMax={phaseMax} />
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TeamCard({ team, schema, phaseMax }: { team: TeamStats; schema: ScoutFormSchema; phaseMax: PhaseValues }) {
  const key = useMemo(() => buildKeyStats(team, schema), [team, schema]);
  const lowSample = team.entryCount < DEFAULT_MIN_ENTRIES;
  const isOurs = useIsOurTeam()(team.teamNumber);

  return (
    <AnalyticsLink
      href={`/analytics/teams/${team.teamNumber}`}
      className="block h-full rounded-[28px] outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.6)]"
      aria-label={`Team ${team.teamNumber}${team.teamName ? `, ${team.teamName}` : ""} — open profile`}
    >
      <GlassPanel interactive className={cn("flex h-full flex-col gap-4", isOurs && "ring-2 ring-[var(--color-primary)]")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums">{team.teamNumber}</span>
              {isOurs && <OurTeamTag />}
            </div>
            <div className="truncate text-sm text-[var(--muted-foreground)]">{team.teamName ?? "—"}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <ReliabilityPill team={team} schema={schema} />
            {lowSample && <LowSampleBadge entryCount={team.entryCount} min={DEFAULT_MIN_ENTRIES} />}
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Avg. total</div>
            <div className="text-4xl font-semibold tracking-tight tabular-nums">{team.avgTotal.toFixed(1)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Scouted</div>
            <div className="text-lg font-semibold tabular-nums">
              {team.entryCount}
              <span className="text-sm font-normal text-[var(--muted-foreground)]">×</span>
            </div>
          </div>
        </div>

        <PhaseMiniBars values={{ auto: team.avgAuto, teleop: team.avgTeleop, endgame: team.avgEndgame }} max={phaseMax} />

        {(key.counters.length > 0 || key.rates.length > 0) && (
          <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[var(--glass-border)] pt-3 text-xs">
            {key.counters.map((c) => (
              <div key={c.label} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[var(--muted-foreground)]">Avg {c.label}</span>
                <span className="font-semibold tabular-nums">{c.avg.toFixed(1)}</span>
              </div>
            ))}
            {key.rates.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[var(--muted-foreground)]">{r.label}</span>
                <span className="font-semibold tabular-nums">{Math.round(r.rate)}%</span>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </AnalyticsLink>
  );
}

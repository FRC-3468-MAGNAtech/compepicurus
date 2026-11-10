"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ExternalLink, SearchX, Trophy } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { CommentCell } from "@/components/analytics/comment-cell";
import { PitAndStrategySection } from "@/components/analytics/pit-and-strategy";
import { ScoreChart } from "@/components/analytics/score-chart";
import { LowSampleBadge } from "@/components/analytics/team-bits";
import { useAnalyticsData, useTeamStats } from "@/lib/analytics/data-context";
import { useAnalyticsHref, useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { useEventRankings } from "@/lib/analytics/use-event-data";
import { DEFAULT_MIN_ENTRIES, lowSample, schemaFieldMeta, type FieldStat, type TeamStats, type Trend } from "@/lib/analytics/team-stats";
import { getPercentColor } from "@/lib/accuracy/engine";
import { cardEntranceVariants } from "@/lib/motion";
import type { Form } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

export default function TeamProfilePage() {
  const params = useParams<{ teamNumber: string }>();
  const teamNumber = Number(params.teamNumber);
  const validNumber = Number.isInteger(teamNumber) && teamNumber > 0;

  const { teamStats, teamNames, loaded, schema } = useTeamStats();
  const stats = useMemo(() => (validNumber ? teamStats.find((t) => t.teamNumber === teamNumber) ?? null : null), [teamStats, teamNumber, validNumber]);
  const teamName = teamNames.get(teamNumber) ?? null;

  if (!validNumber) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton />
        <EmptyState title="Team not found" body={`“${params.teamNumber}” isn’t a valid team number.`} />
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton />
        <div className="glass-card h-40 animate-pulse" />
        <div className="glass-card h-64 animate-pulse" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton />
        <EmptyState
          title={`Team ${teamNumber}${teamName ? ` · ${teamName}` : ""}`}
          body="No scouted data for this team with the current filters."
          showReset
        />
        <PitAndStrategySection teamNumber={teamNumber} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton />
      <ProfileHeader stats={{ ...stats, teamName: stats.teamName ?? teamName }} />
      <StatTiles stats={stats} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <GlassPanel className="flex flex-col gap-3 xl:col-span-3">
          <h2 className="text-base font-semibold">Total score by match</h2>
          <ScoreChart matches={stats.matchesScouted} average={stats.avgTotal} />
        </GlassPanel>
        <MatchList stats={stats} />
      </div>

      <Averages stats={stats} schema={schema} />
      <Elements stats={stats} />
      <Comments stats={stats} />
      <PitAndStrategySection teamNumber={teamNumber} />
    </div>
  );
}

// --- header & tiles ----------------------------------------------------------

function BackButton() {
  const router = useRouter();
  const withFilters = useAnalyticsHref();
  return (
    <div>
      <Button
        variant="glass"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          // Back to whichever page the user came from; a deep link has no history, so fall back to Team Averages.
          if (window.history.length > 1) router.back();
          else router.push(withFilters("/analytics/team-averages"));
        }}
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
    </div>
  );
}

function EmptyState({ title, body, showReset }: { title: string; body: string; showReset?: boolean }) {
  const { resetFilters, query } = useAnalyticsFilters();
  return (
    <GlassPanel className="flex flex-col items-center gap-3 py-12 text-center">
      <SearchX className="h-8 w-8 text-[var(--muted-foreground)]" />
      <div>
        <div className="font-semibold">{title}</div>
        <p className="text-sm text-[var(--muted-foreground)]">{body}</p>
      </div>
      {showReset && query !== "" && (
        <Button variant="glass" size="sm" onClick={resetFilters}>
          Reset filters
        </Button>
      )}
    </GlassPanel>
  );
}

function ProfileHeader({ stats }: { stats: TeamStats }) {
  const data = useAnalyticsData();
  const { filters } = useAnalyticsFilters();
  const eventCodes = useMemo(() => [...new Set(stats.matchesScouted.map((m) => m.eventCode))], [stats.matchesScouted]);

  // Official FIRST rankings only exist for real events.
  const requests = useMemo(
    () => (filters.practice ? [] : eventCodes.map((code) => ({ code, season: data.eventDirectory.get(code)?.season ?? data.season }))),
    [filters.practice, eventCodes, data.eventDirectory, data.season]
  );
  const rankings = useEventRankings(requests);
  const official = eventCodes
    .map((code) => ({ code, row: rankings.get(code)?.find((r) => r.teamNumber === stats.teamNumber) }))
    .filter((x): x is { code: string; row: NonNullable<typeof x.row> } => !!x.row);

  return (
    <GlassPanel strong className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Team</div>
          <h2 className="text-3xl font-semibold tracking-tight tabular-nums">{stats.teamNumber}</h2>
          <div className="truncate text-lg text-[var(--muted-foreground)]">{stats.teamName ?? "Name unavailable"}</div>
        </div>
        {lowSample(stats) && <LowSampleBadge entryCount={stats.entryCount} min={DEFAULT_MIN_ENTRIES} className="text-xs" />}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="glass">
          {stats.entryCount} {stats.entryCount === 1 ? "entry" : "entries"} used
        </Badge>
        <Badge variant="glass">
          Avg. accuracy{" "}
          {stats.avgAccuracy === null ? (
            "—"
          ) : (
            <span className={cn("font-semibold tabular-nums", getPercentColor(stats.avgAccuracy))}>{Math.round(stats.avgAccuracy)}%</span>
          )}
        </Badge>
        {official.map(({ code, row }) => (
          <Badge key={code} variant="success" className="gap-1.5" title="Official FIRST qualification ranking">
            <Trophy className="h-3 w-3" />
            Rank {row.rank} · {row.wins}-{row.losses}-{row.ties}
            <span className="font-normal opacity-80">· {data.eventDirectory.get(code)?.name ?? code}</span>
          </Badge>
        ))}
      </div>
    </GlassPanel>
  );
}

function StatTiles({ stats }: { stats: TeamStats }) {
  const tiles: { label: string; value: string; extra?: React.ReactNode }[] = [
    { label: "Avg. total", value: stats.avgTotal.toFixed(1), extra: <TrendChip trend={stats.trend} /> },
    { label: "High", value: String(stats.highTotal) },
    { label: "Low", value: String(stats.lowTotal) },
    { label: "Median", value: stats.medianTotal.toFixed(1) },
    { label: "Consistency", value: `${Math.round(stats.consistency)}%`, extra: <span className="text-xs text-[var(--muted-foreground)]">σ {stats.stdDev.toFixed(1)}</span> },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map((t, i) => (
        <motion.div key={t.label} variants={cardEntranceVariants} initial="hidden" animate="show" custom={i}>
          <GlassPanel className="flex h-full flex-col gap-1.5 p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{t.label}</span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">{t.value}</span>
            <div className="min-h-4">{t.extra}</div>
          </GlassPanel>
        </motion.div>
      ))}
    </div>
  );
}

function TrendChip({ trend }: { trend: Trend }) {
  if (trend.direction === null) return <span className="text-xs text-[var(--muted-foreground)]">Trend needs 4+ entries</span>;
  const Icon = trend.direction === "up" ? ArrowUp : trend.direction === "down" ? ArrowDown : ArrowRight;
  const tone = trend.direction === "up" ? "text-emerald-300" : trend.direction === "down" ? "text-red-300" : "text-[var(--muted-foreground)]";
  const label = trend.direction === "flat" ? "Steady" : `${trend.delta > 0 ? "+" : ""}${trend.delta.toFixed(1)}`;
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium", tone)} title={`Last ${trend.recentCount} matches averaged ${trend.recentAvg?.toFixed(1)} vs the overall average`}>
      <Icon className="h-3.5 w-3.5" /> {label} <span className="font-normal text-[var(--muted-foreground)]">recent</span>
    </span>
  );
}

// --- match list ----------------------------------------------------------------

function MatchList({ stats }: { stats: TeamStats }) {
  return (
    <GlassPanel className="flex flex-col gap-3 xl:col-span-2">
      <h2 className="text-base font-semibold">Matches scouted</h2>
      <div className="flex max-h-[18rem] flex-col gap-1.5 overflow-y-auto pr-1">
        {stats.matchesScouted.map((m) => (
          <div key={m.entryId} className="glass-card flex items-center gap-3 p-2.5 text-sm">
            <AnalyticsLink
              href="/analytics/match-breakdown"
              params={{ event: m.eventCode, match: m.label }}
              className="min-w-12 rounded-lg px-2 py-1 font-mono font-semibold hover:bg-white/10"
              title="Open in Match Breakdown"
            >
              {m.label}
            </AnalyticsLink>
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">
              {m.eventCode} · {m.auto}/{m.teleop}/{m.endgame}
              {m.accuracy !== null && <> · {Math.round(m.accuracy)}%</>}
            </span>
            <span className="font-semibold tabular-nums">{m.total}</span>
            <AnalyticsLink
              href="/analytics/match-scout"
              params={{ events: m.eventCode, team: String(stats.teamNumber), match: m.label }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]"
              aria-label={`Open ${m.label} in Match Scout Analytics`}
              title="Open the raw entry in Match Scout Analytics"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </AnalyticsLink>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

// --- averages (schema-generated) ---------------------------------------------------

function Bar({ fraction }: { fraction: number }) {
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: "var(--theme-gradient-h)" }}
      />
    </span>
  );
}

function FieldRow({ stat }: { stat: FieldStat }) {
  const isCounter = stat.type === "counter";
  const fraction = isCounter ? (stat.high ? (stat.avg ?? 0) / stat.high : 0) : (stat.rate ?? 0) / 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{stat.label}</span>
        <span className="tabular-nums text-[var(--muted-foreground)]">
          {isCounter ? (
            <>
              <strong className="text-[var(--foreground)]">{(stat.avg ?? 0).toFixed(2)}</strong> avg · high {stat.high}
            </>
          ) : (
            <strong className="text-[var(--foreground)]">{Math.round(stat.rate ?? 0)}%</strong>
          )}
          {stat.avgPoints !== null && <> · {stat.avgPoints.toFixed(1)} pts</>}
        </span>
      </div>
      <Bar fraction={fraction} />
    </div>
  );
}

function Averages({ stats, schema }: { stats: TeamStats; schema: Form }) {
  const meta = useMemo(() => schemaFieldMeta(schema), [schema]);
  const phaseAvg: Record<string, number> = { auto: stats.avgAuto, teleop: stats.avgTeleop, endgame: stats.avgEndgame };

  // The scoring sections, in schema order; General's checkboxes are the incident rates below.
  const sections = schema.sections
    .map((section) => {
      const fields = meta.filter((m) => m.sectionId === section.id && stats.fieldStats[m.field.key] && m.scored);
      return { section, fields, phase: fields[0]?.phase };
    })
    .filter((s) => s.fields.length > 0);

  const incidents = meta.filter((m) => m.field.type === "checkbox" && stats.fieldStats[m.field.key]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {sections.map(({ section, fields, phase }) => {
        const groups = [...new Set(fields.map((f) => f.groupLabel))];
        return (
          <GlassPanel key={section.id} className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{section.title}</h2>
              {phase && phaseAvg[phase] !== undefined && <span className="text-sm tabular-nums text-[var(--muted-foreground)]">avg {phaseAvg[phase].toFixed(1)} pts</span>}
            </div>
            {groups.map((group) => (
              <div key={group ?? "_"} className="flex flex-col gap-3">
                {group && <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{group}</h3>}
                {fields.filter((f) => f.groupLabel === group).map((f) => (
                  <FieldRow key={f.field.key} stat={stats.fieldStats[f.field.key]} />
                ))}
              </div>
            ))}
          </GlassPanel>
        );
      })}

      {incidents.length > 0 && (
        <GlassPanel className="flex flex-col gap-3 lg:col-span-3">
          <h2 className="text-base font-semibold">Incident rates</h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {incidents.map((f) => (
              <FieldRow key={f.field.key} stat={stats.fieldStats[f.field.key]} />
            ))}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}

function Elements({ stats }: { stats: TeamStats }) {
  const max = Math.max(0, ...stats.elementBreakdown.map((e) => e.avgPoints));
  if (stats.elementBreakdown.length === 0) return null;
  return (
    <GlassPanel className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Points by game element</h2>
        <span className="text-xs text-[var(--muted-foreground)]">average points per match, all phases</span>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {stats.elementBreakdown.map((e) => (
          <div key={e.element} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-sm">
              <span>{e.element}</span>
              <span className="tabular-nums text-[var(--muted-foreground)]">
                <strong className="text-[var(--foreground)]">{e.avgPoints.toFixed(1)}</strong> pts · {Math.round(e.share * 100)}%
              </span>
            </div>
            <Bar fraction={max > 0 ? e.avgPoints / max : 0} />
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

function Comments({ stats }: { stats: TeamStats }) {
  const withComments = stats.matchesScouted.filter((m) => m.comments.trim() !== "");
  return (
    <GlassPanel className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Scout comments {withComments.length > 0 && <span className="text-[var(--muted-foreground)]">({withComments.length})</span>}</h2>
      {withComments.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No scout comments for this team.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {withComments.map((m) => (
            <div key={m.entryId} className="glass-card flex items-start gap-3 p-3 text-sm">
              <span className="min-w-12 pt-1 font-mono text-xs font-semibold">{m.label}</span>
              <div className="min-w-0 flex-1">
                {/* Collapsed to one line; click to expand — same behaviour as Match Scout Analytics' Comments column. */}
                <CommentCell text={m.comments} forceExpanded={false} />
                <div className="text-[11px] text-[var(--muted-foreground)]">{m.scoutName}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

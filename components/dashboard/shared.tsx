"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Hourglass } from "lucide-react";
import { ReliabilityPill } from "@/components/analytics/reliability-pill";
import { Badge } from "@/components/ui/badge";
import type { AllianceColor } from "@/lib/analytics/match-breakdown";
import type { TeamStats } from "@/lib/analytics/team-stats";
import type { MatchResult, OurMatch } from "@/lib/dashboard/schedule";
import { formatCountdown, formatScheduled } from "@/lib/dashboard/time";
import type { WidgetSize } from "@/lib/dashboard/types";
import type { ScoutFormSchema } from "@/lib/scout-form/schema";
import { cn } from "@/lib/utils";

/** Team Profile link, scoped to the dashboard's event so the profile opens on the same event's data. */
export function teamHref(teamNumber: number, eventCode: string | null): string {
  return eventCode ? `/analytics/teams/${teamNumber}?events=${encodeURIComponent(eventCode)}` : `/analytics/teams/${teamNumber}`;
}

/** A ticking "now" (ms) that re-renders only its caller — countdowns own their own timer so the rest of the dashboard doesn't re-render every second. */
export function useNow(intervalMs: number = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Time until a scheduled start, big. Always labelled "Scheduled": FIRST's
 * schedule is a plan — matches run early and late — so this is a guide, not a
 * promise. Shows "Now" once the scheduled time has passed.
 */
export function Countdown({ startMs, timeZone, large }: { startMs: number | null; timeZone: string | null; large?: boolean }) {
  const now = useNow(1000);
  if (startMs === null) {
    return <div className="text-sm text-[var(--muted-foreground)]">Scheduled time not published yet</div>;
  }
  return (
    <div>
      <div className={cn("font-semibold tabular-nums tracking-tight", large ? "text-5xl" : "text-3xl")} aria-live="off">
        {formatCountdown(startMs - now)}
      </div>
      <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">Scheduled {formatScheduled(startMs, timeZone)}</div>
    </div>
  );
}

const ALLIANCE_STYLE: Record<AllianceColor, string> = {
  red: "bg-red-500/15 text-red-300 border border-red-400/30",
  blue: "bg-blue-500/15 text-blue-300 border border-blue-400/30",
};

export function AllianceChip({ color, className }: { color: AllianceColor; className?: string }) {
  return (
    <Badge variant="outline" className={cn(ALLIANCE_STYLE[color], "capitalize", className)}>
      {color} alliance
    </Badge>
  );
}

const RESULT_STYLE: Record<MatchResult, { variant: "success" | "danger" | "outline"; label: string }> = {
  W: { variant: "success", label: "W" },
  L: { variant: "danger", label: "L" },
  T: { variant: "outline", label: "T" },
};

export function ResultBadge({ result }: { result: MatchResult }) {
  const s = RESULT_STYLE[result];
  return (
    <Badge variant={s.variant} className="min-w-7 justify-center" aria-label={result === "W" ? "Win" : result === "L" ? "Loss" : "Tie"}>
      {s.label}
    </Badge>
  );
}

export function TeamLink({ teamNumber, eventCode, children, className }: { teamNumber: number; eventCode: string | null; children?: React.ReactNode; className?: string }) {
  return (
    <Link href={teamHref(teamNumber, eventCode)} className={cn("font-semibold tabular-nums underline-offset-4 hover:underline", className)}>
      {children ?? teamNumber}
    </Link>
  );
}

/** One played match: label, official score from our side, and the result. */
export function ResultRow({ match }: { match: OurMatch }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="min-w-10 rounded-lg bg-white/10 px-2 py-0.5 text-center font-mono text-xs font-semibold">{match.label}</span>
      <AllianceChip color={match.alliance} className="hidden sm:inline-flex" />
      <span className="flex-1 tabular-nums">
        <strong>{match.ourScore}</strong> <span className="text-[var(--muted-foreground)]">–</span> {match.theirScore}
      </span>
      {match.result && <ResultBadge result={match.result} />}
    </div>
  );
}

/** A big number with a label and an optional context line — the "one key number" most widgets lead with. */
export function KeyNumber({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className="text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{hint}</div>}
    </div>
  );
}

/**
 * A team on a match-preview line: number, name, average total, auto and teleop
 * averages, and the reliability pill — all from scouted `TeamStats`. With no
 * scouted data it says so instead of showing zeros.
 */
export function TeamPreviewRow({
  teamNumber,
  teamName,
  stats,
  schema,
  eventCode,
  role,
}: {
  teamNumber: number;
  teamName: string | null;
  stats: TeamStats | null;
  schema: ScoutFormSchema;
  eventCode: string | null;
  role?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--glass-border)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <TeamLink teamNumber={teamNumber} eventCode={eventCode} className="text-sm" />
          {teamName && <span className="ml-2 truncate text-xs text-[var(--muted-foreground)]">{teamName}</span>}
        </div>
        {role && <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{role}</span>}
      </div>
      {stats && stats.entryCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>
            Avg <strong className="text-sm tabular-nums">{stats.avgTotal.toFixed(1)}</strong>
          </span>
          <span className="text-[var(--muted-foreground)]">
            Auto <strong className="tabular-nums text-[var(--foreground)]">{stats.avgAuto.toFixed(1)}</strong>
          </span>
          <span className="text-[var(--muted-foreground)]">
            Teleop <strong className="tabular-nums text-[var(--foreground)]">{stats.avgTeleop.toFixed(1)}</strong>
          </span>
          <ReliabilityPill team={stats} schema={schema} />
          <span className="text-[var(--muted-foreground)]">{stats.entryCount}× scouted</span>
        </div>
      ) : (
        <div className="text-xs text-[var(--muted-foreground)]">No scouted data yet</div>
      )}
    </div>
  );
}

/**
 * The one "Coming soon" card a role gets when part of its job has no feature
 * in the app yet. It's a placeholder, not a feature: no controls, no data —
 * and visibly different from a real widget (dashed outline) so it never reads
 * as broken.
 */
export function ComingSoonCard({ title, description }: { title: string; description?: string; size?: WidgetSize }) {
  return (
    <section className="flex h-full min-h-[176px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-[var(--glass-border)] bg-white/[0.03] p-4 text-center">
      <Hourglass className="h-5 w-5 text-[var(--muted-foreground)]" />
      <h3 className="text-sm font-semibold">{title}</h3>
      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
        Coming soon
      </Badge>
      {description && <p className="max-w-xs text-xs text-[var(--muted-foreground)]">{description}</p>}
    </section>
  );
}

"use client";

import { useMemo } from "react";
import { BarChart3, Eye } from "lucide-react";
import { CommentCell } from "@/components/analytics/comment-cell";
import { PHASES } from "@/components/analytics/phase-bars";
import { Widget } from "@/components/dashboard/widget";
import { teamHref } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { formatMatch } from "@/lib/analytics/game-schema";
import { schemaFieldMeta } from "@/lib/analytics/team-stats";
import { hasRole } from "@/lib/forms/meta";
import { entryValues } from "@/lib/forms/legacy";
import { useDashboard } from "@/lib/dashboard/data";
import { phaseAverages } from "@/lib/dashboard/insights";
import { cn } from "@/lib/utils";

/**
 * What scouts saw on *our* robot: how many of our matches had each robot-failure
 * incident (died, tipped, disabled, froze, never started — the schema's
 * reliability fields) and the latest comments about us. Built only from our own scout entries.
 */
export function ScoutsSawWidget() {
  const d = useDashboard();
  const ours = useMemo(() => d.usedEntries.filter((e) => e.teamNumber === d.ourNumber), [d.usedEntries, d.ourNumber]);

  const incidents = useMemo(
    () =>
      schemaFieldMeta(d.schema)
        .filter((m) => hasRole(m.field, "reliability"))
        .map((m) => ({ key: m.field.key, label: m.field.label, count: ours.filter((e) => entryValues(e, d.schema)[m.field.key] === true).length })),
    [d.schema, ours]
  );
  const comments = useMemo(
    () => ours.filter((e) => e.comments.trim() !== "").sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 3),
    [ours]
  );
  const code = d.event?.code ?? null;

  return (
    <Widget
      title="What scouts saw on us"
      icon={Eye}
      size="wide"
      status={!d.entriesLoaded ? "loading" : ours.length === 0 ? "empty" : "ready"}
      href={d.ourNumber !== null ? teamHref(d.ourNumber, code) : undefined}
      linkLabel="Our team profile"
      emptyText={d.ourNumber === null ? "Our team number isn't set." : "Scouts haven't logged an entry on our robot at this event yet."}
    >
      <div className="text-xs text-[var(--muted-foreground)]">From {ours.length} scouted {ours.length === 1 ? "match" : "matches"}</div>
      <div className="flex flex-wrap gap-2">
        {incidents.map((i) => (
          <Badge key={i.key} variant={i.count > 0 ? "warning" : "outline"} className="gap-1.5 text-xs">
            {i.label} <strong className="tabular-nums">{i.count}</strong>
          </Badge>
        ))}
      </div>
      {comments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {comments.map((e) => (
            <div key={e.id} className="flex items-start gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-2 text-sm">
              <span className="min-w-10 pt-0.5 font-mono text-xs font-semibold">{formatMatch(e)}</span>
              <div className="min-w-0 flex-1">
                <CommentCell text={e.comments} forceExpanded={false} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

/** Our average auto / teleop / endgame next to the event average (the mean over every scouted entry at the event). */
export function PhaseVsEventWidget() {
  const d = useDashboard();
  const event = useMemo(() => phaseAverages(d.usedEntries), [d.usedEntries]);
  const ours = d.ourStats;
  const max = Math.max(1, ...PHASES.flatMap((p) => [ours ? ours[p.key === "auto" ? "avgAuto" : p.key === "teleop" ? "avgTeleop" : "avgEndgame"] : 0, event?.[p.key] ?? 0]));

  return (
    <Widget
      title="Our phases vs the event"
      icon={BarChart3}
      size="medium"
      status={!d.entriesLoaded ? "loading" : !ours || !event ? "empty" : "ready"}
      href="/analytics/team-averages"
      linkLabel="Team Averages"
      emptyText="Shows up once scouts have logged our matches."
    >
      {ours && event && (
        <div className="flex flex-col gap-3">
          {PHASES.map((p) => {
            const mine = ours[p.key === "auto" ? "avgAuto" : p.key === "teleop" ? "avgTeleop" : "avgEndgame"];
            const avg = event[p.key];
            const better = mine >= avg;
            return (
              <div key={p.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{p.full}</span>
                  <span className="tabular-nums text-[var(--muted-foreground)]">
                    <strong className="text-[var(--foreground)]">{mine.toFixed(1)}</strong> vs {avg.toFixed(1)}{" "}
                    <span className={cn("text-xs font-medium", better ? "text-emerald-300" : "text-amber-300")}>{better ? "above" : "below"} avg</span>
                  </span>
                </div>
                <div className="flex flex-col gap-1" aria-hidden>
                  <span className="h-2 overflow-hidden rounded-full bg-white/8">
                    <span className="block h-full rounded-full" style={{ width: `${(mine / max) * 100}%`, background: p.color }} />
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-white/8">
                    <span className="block h-full rounded-full bg-white/35" style={{ width: `${(avg / max) * 100}%` }} />
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex gap-4 text-[11px] text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 rounded-full" style={{ background: "var(--phase-teleop)" }} /> Us
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 rounded-full bg-white/35" /> Event average
            </span>
          </div>
        </div>
      )}
    </Widget>
  );
}

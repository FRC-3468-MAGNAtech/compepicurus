"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverTip } from "@/components/ui/hover-tip";
import { STATUS_CATEGORIES, type StatusCategory } from "@/lib/scout-status/categories";
import type { MatchCoverage, RobotCoverage } from "@/lib/scout-status/compute";
import { cn } from "@/lib/utils";

/** Rendering a whole event's matches at once would be slow; each group shows this many and offers "Show more". */
const PAGE = 40;

function RobotChip({ robot, state }: { robot: RobotCoverage; state: MatchCoverage["state"] }) {
  const scouted = robot.scouts.length > 0;
  const tone = robot.alliance === "red" ? "border-red-400/30 bg-red-500/10" : "border-blue-400/30 bg-blue-500/10";
  // Unplayed (upcoming) matches don't look missed: a muted circle instead of a red X until the match has been played.
  const status = scouted ? "scouted" : state === "upcoming" ? "not yet played" : "not scouted";
  const body = (
    <span tabIndex={0} className={cn("inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]", tone, !scouted && state === "upcoming" && "opacity-60")} aria-label={`Team ${robot.teamNumber}, ${status}${scouted ? ` by ${robot.scouts.map((s) => s.name).join(", ")}` : ""}`}>
      <span className="font-semibold tabular-nums">{robot.teamNumber}</span>
      {scouted ? (
        <span className="inline-flex text-emerald-300" aria-hidden>
          {robot.scouts.map((s) => (
            <Check key={s.uid} className="h-3.5 w-3.5" strokeWidth={3} />
          ))}
        </span>
      ) : state === "upcoming" ? (
        <Circle className="h-3 w-3 text-[var(--muted-foreground)]" aria-hidden />
      ) : (
        <X className="h-3.5 w-3.5 text-red-300" strokeWidth={3} aria-hidden />
      )}
    </span>
  );
  return scouted ? <HoverTip content={robot.scouts.map((s) => s.name).join(", ")}>{body}</HoverTip> : body;
}

function MatchRow({ coverage, showEvent }: { coverage: MatchCoverage; showEvent: boolean }) {
  const { match, robots, scoutedCount, state } = coverage;
  const red = robots.filter((r) => r.alliance === "red");
  const blue = robots.filter((r) => r.alliance === "blue");
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[var(--glass-border)] bg-white/4 px-3 py-2.5">
      <span className="w-14 shrink-0 font-mono text-sm font-semibold">
        {match.label}
        {showEvent && <span className="block truncate text-[10px] font-normal text-[var(--muted-foreground)]">{match.eventCode}</span>}
      </span>
      <div className="flex flex-wrap gap-1.5">{red.map((r) => <RobotChip key={`r${r.teamNumber}`} robot={r} state={state} />)}</div>
      <div className="flex flex-wrap gap-1.5">{blue.map((r) => <RobotChip key={`b${r.teamNumber}`} robot={r} state={state} />)}</div>
      <span className={cn("ml-auto text-xs tabular-nums", state === "upcoming" ? "text-[var(--muted-foreground)]" : scoutedCount === robots.length ? "text-emerald-300" : "text-[var(--foreground)]")}>
        {scoutedCount}/{robots.length} scouted{state === "upcoming" ? " · upcoming" : ""}
      </span>
    </li>
  );
}

export function CoverageList({ coverage, enabled, showEvent }: { coverage: MatchCoverage[]; enabled: ReadonlySet<StatusCategory>; showEvent: boolean }) {
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Record<string, number>>({});

  const groups = useMemo(() => {
    return STATUS_CATEGORIES.filter((c) => enabled.has(c.id)).map((c) => {
      const all = coverage.filter((m) => m.match.category === c.id);
      // "Missing" = a played match with an unscouted robot (an upcoming match isn't missed yet).
      const list = onlyMissing ? all.filter((m) => m.state === "played" && m.scoutedCount < m.robots.length) : all;
      return { ...c, all, list };
    });
  }, [coverage, enabled, onlyMissing]);

  const total = coverage.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={onlyMissing ? "primary" : "glass"} aria-pressed={onlyMissing} onClick={() => setOnlyMissing((v) => !v)}>
          Show only missing
        </Button>
        <span className="text-xs text-[var(--muted-foreground)]">
          {total} match{total === 1 ? "" : "es"} · ✓ per scout who scouted a robot · ✗ played but not scouted · ○ not played yet
        </span>
      </div>

      {total === 0 && <p className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">No matches to show — the schedule for these events isn&apos;t available yet, or the category filter and ranges leave nothing.</p>}

      {groups.map((g) => {
        if (g.all.length === 0) return null;
        const isCollapsed = collapsed.has(g.id);
        const limit = shown[g.id] ?? PAGE;
        const scouted = g.all.filter((m) => m.scoutedCount === m.robots.length).length;
        return (
          <section key={g.id} className="rounded-2xl border border-[var(--glass-border)]">
            <button type="button" aria-expanded={!isCollapsed} onClick={() => setCollapsed((cur) => { const next = new Set(cur); if (!next.delete(g.id)) next.add(g.id); return next; })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="font-semibold">{g.label}</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                {g.all.length} match{g.all.length === 1 ? "" : "es"} · {scouted} fully scouted
              </span>
              <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", !isCollapsed && "rotate-180")} aria-hidden />
            </button>
            {!isCollapsed && (
              <div className="flex flex-col gap-2 px-3 pb-3">
                {g.list.length === 0 && <p className="px-1 py-2 text-sm text-[var(--muted-foreground)]">{onlyMissing ? "Nothing missing here." : "No matches."}</p>}
                <ul className="flex flex-col gap-2">
                  {g.list.slice(0, limit).map((m) => (
                    <MatchRow key={m.match.key} coverage={m} showEvent={showEvent} />
                  ))}
                </ul>
                {g.list.length > limit && (
                  <Button size="sm" variant="ghost" className="self-start" onClick={() => setShown((cur) => ({ ...cur, [g.id]: limit + PAGE }))}>
                    Show {Math.min(PAGE, g.list.length - limit)} more ({g.list.length - limit} left)
                  </Button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

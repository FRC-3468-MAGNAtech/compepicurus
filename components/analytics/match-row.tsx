"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronDown, ExternalLink, EyeOff, Star, Trophy } from "lucide-react";
import { OUR_TEAM_ROW_CLASS, OurTeamTag } from "@/components/analytics/team-bits";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { AllianceBar } from "@/components/analytics/alliance-bar";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { PhaseLegend, PhaseStackedBar } from "@/components/analytics/phase-bars";
import { Badge } from "@/components/ui/badge";
import { getPercentColor } from "@/lib/accuracy/engine";
import type { AllianceBreakdown, AllianceColor, MatchBreakdown, TeamSlot } from "@/lib/analytics/match-breakdown";
import { summarizeEntry } from "@/lib/analytics/match-breakdown";
import { spring, springSoft } from "@/lib/motion";
import type { ScoutFormSchema } from "@/lib/scout-form/schema";
import { cn } from "@/lib/utils";

const SIDE = {
  red: { label: "Red", text: "text-red-300", badge: "bg-red-500/15 text-red-300 border border-red-400/30" },
  blue: { label: "Blue", text: "text-blue-300", badge: "bg-blue-500/15 text-blue-300 border border-blue-400/30" },
} as const;

/** DOM id a deep link (`?event=&match=`) scrolls to. */
export function matchRowId(key: string): string {
  return `match-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * One match: a summary line (label, coverage, animated alliance bar, totals)
 * that expands into the full detail. Team numbers are links outside the
 * toggle button, so tapping a team opens its profile instead of the drawer.
 */
export function MatchRow({
  breakdown,
  schema,
  expanded,
  onToggle,
  showEvent,
}: {
  breakdown: MatchBreakdown;
  schema: ScoutFormSchema;
  expanded: boolean;
  onToggle: () => void;
  showEvent: boolean;
}) {
  const { match, red, blue } = breakdown;
  const detailId = `${matchRowId(breakdown.key)}-detail`;

  return (
    <motion.div
      layout="position"
      transition={spring}
      id={matchRowId(breakdown.key)}
      className={cn("glass-card scroll-mt-24 overflow-hidden", !breakdown.scouted && "opacity-60")}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
        className="flex w-full flex-col gap-2.5 p-4 text-left outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-sm font-semibold">{breakdown.label}</span>
          {showEvent && <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{match.eventCode}</span>}
          <CoverageChip scouted={breakdown.robotsScouted} total={breakdown.robotsTotal} />
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={spring} className="ml-auto text-[var(--muted-foreground)]">
            <ChevronDown className="h-5 w-5" />
          </motion.span>
        </div>

        <div className="flex items-end justify-between gap-3 text-sm">
          <SideTotal side="red" alliance={red} winner={breakdown.winner === "red"} />
          <SideTotal side="blue" alliance={blue} winner={breakdown.winner === "blue"} align="right" />
        </div>
        <AllianceBar fraction={breakdown.redFraction} winner={breakdown.winner} />
      </button>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-[var(--glass-border)] px-4 py-2 text-xs">
        <TeamLinks teams={match.red.teams} side="red" />
        <TeamLinks teams={match.blue.teams} side="blue" align="right" />
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={detailId}
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springSoft}
            className="overflow-hidden"
          >
            <MatchDetail breakdown={breakdown} schema={schema} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CoverageChip({ scouted, total }: { scouted: number; total: number }) {
  if (scouted === 0) return <Badge variant="outline">Not scouted</Badge>;
  return (
    <Badge variant={scouted === total ? "success" : "glass"} title="Robots with a scout entry">
      {scouted}/{total} robots scouted
    </Badge>
  );
}

/** One alliance's end of the summary line: its scouted total, or why there isn't one. */
function SideTotal({ side, alliance, winner, align }: { side: AllianceColor; alliance: AllianceBreakdown; winner: boolean; align?: "right" }) {
  const s = SIDE[side];
  return (
    <div className={cn("flex min-w-0 flex-col", align === "right" && "items-end text-right")}>
      <span className={cn("flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide", s.text)}>
        {align !== "right" && winner && <Trophy className="h-3.5 w-3.5" aria-label="Winner" />}
        {s.label}
        {align === "right" && winner && <Trophy className="h-3.5 w-3.5" aria-label="Winner" />}
      </span>
      {alliance.visibility === "shown" ? (
        <span className={cn("tabular-nums", winner ? "text-2xl font-bold" : "text-xl font-semibold")}>{alliance.scoutedTotal}</span>
      ) : alliance.visibility === "below-accuracy" ? (
        <span className="flex items-center gap-1 text-xs text-amber-300">
          <EyeOff className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{alliance.hiddenReason}</span>
        </span>
      ) : (
        <span className="text-xl text-[var(--muted-foreground)]">—</span>
      )}
    </div>
  );
}

function TeamLinks({ teams, side, align }: { teams: number[]; side: AllianceColor; align?: "right" }) {
  const isOurs = useIsOurTeam();
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", align === "right" && "justify-end")}>
      {teams.length === 0 && <span className="text-[var(--muted-foreground)]">TBD</span>}
      {teams.map((t) => (
        <AnalyticsLink
          key={t}
          href={`/analytics/teams/${t}`}
          className={cn(
            "flex min-h-8 items-center gap-1 rounded-full px-3 font-semibold tabular-nums transition-colors hover:brightness-125",
            SIDE[side].badge,
            isOurs(t) && "ring-2 ring-[var(--color-primary)]"
          )}
          aria-label={`Team ${t} profile${isOurs(t) ? " (one of our FTC teams)" : ""}`}
        >
          {isOurs(t) && <Star className="h-3 w-3" aria-hidden />}
          {t}
        </AnalyticsLink>
      ))}
    </div>
  );
}

// --- detail ----------------------------------------------------------------------

function MatchDetail({ breakdown, schema }: { breakdown: MatchBreakdown; schema: ScoutFormSchema }) {
  const { match } = breakdown;
  const shownTotals = [...breakdown.red.teams, ...breakdown.blue.teams].map((t) => t.entry?.score.total ?? 0);
  // One scale for all four robots, so their bars compare with each other.
  const scaleMax = Math.max(1, ...shownTotals);

  return (
    <div className="flex flex-col gap-4 border-t border-[var(--glass-border)] p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AllianceCard side="red" alliance={breakdown.red} winner={breakdown.winner === "red"} scaleMax={scaleMax} schema={schema} />
        <AllianceCard side="blue" alliance={breakdown.blue} winner={breakdown.winner === "blue"} scaleMax={scaleMax} schema={schema} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PhaseLegend />
        <div className="flex flex-wrap items-center gap-2">
          {breakdown.winner && (
            <span className="text-xs text-[var(--muted-foreground)]">
              {breakdown.winner === "tie" ? "Tie" : `${SIDE[breakdown.winner].label} won`} ({breakdown.winnerBasis === "official" ? "official result" : "by scouted totals"})
            </span>
          )}
          <AnalyticsLink
            href="/analytics/match-scout"
            params={{ events: match.eventCode, match: breakdown.label }}
            className="glass-pill inline-flex h-9 items-center gap-1.5 px-3.5 text-xs font-medium transition-shadow hover:shadow-[0_0_24px_2px_rgba(var(--glow),0.3)]"
          >
            View raw entries <ExternalLink className="h-3.5 w-3.5" />
          </AnalyticsLink>
        </div>
      </div>
    </div>
  );
}

function AllianceCard({
  side,
  alliance,
  winner,
  scaleMax,
  schema,
}: {
  side: AllianceColor;
  alliance: AllianceBreakdown;
  winner: boolean;
  scaleMax: number;
  schema: ScoutFormSchema;
}) {
  const s = SIDE[side];
  const hidden = alliance.visibility === "below-accuracy";

  return (
    <div className={cn("glass-card flex flex-col gap-3 p-4", hidden && "opacity-60", winner && "ring-1 ring-[rgba(var(--glow),0.4)]")}>
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={s.badge}>
          {s.label} alliance
        </Badge>
        {winner && (
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-primary)" }}>
            <Trophy className="h-3.5 w-3.5" /> Winner
          </span>
        )}
      </div>

      {hidden && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300">
          <EyeOff className="h-4 w-4 shrink-0" /> {alliance.hiddenReason}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Alliance total (scouted)</div>
          <div className="text-3xl font-semibold tabular-nums">{alliance.visibility === "shown" ? alliance.scoutedTotal : "—"}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Accuracy</div>
          <div className={cn("text-xl font-semibold tabular-nums", alliance.accuracy !== null && getPercentColor(alliance.accuracy))}>
            {alliance.accuracy === null ? "—" : `${Math.round(alliance.accuracy)}%`}
          </div>
        </div>
      </div>

      {alliance.official && (
        <div className="text-xs text-[var(--muted-foreground)]">
          Official {alliance.official.score}
          {alliance.official.penaltyPoints > 0 && <> (incl. {alliance.official.penaltyPoints} penalty)</>}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {alliance.teams.map((slot) => (
          <TeamRow key={slot.teamNumber} slot={slot} hidden={hidden} scaleMax={scaleMax} schema={schema} />
        ))}
      </div>
    </div>
  );
}

function TeamRow({ slot, hidden, scaleMax, schema }: { slot: TeamSlot; hidden: boolean; scaleMax: number; schema: ScoutFormSchema }) {
  const entry = slot.entry;
  const summary = entry ? summarizeEntry(entry, schema) : null;
  const isOurs = useIsOurTeam()(slot.teamNumber);

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-[var(--glass-border)] p-3", isOurs && OUR_TEAM_ROW_CLASS)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <AnalyticsLink href={`/analytics/teams/${slot.teamNumber}`} className="font-semibold tabular-nums underline-offset-4 hover:underline">
            Team {slot.teamNumber}
          </AnalyticsLink>
          {isOurs && <OurTeamTag />}
        </span>
        {entry ? (
          <span className="text-lg font-semibold tabular-nums">{entry.score.total}</span>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">{hidden && slot.scouted ? "Scouted — numbers hidden" : "Not scouted"}</span>
        )}
      </div>

      {entry && summary && (
        <>
          <PhaseStackedBar auto={entry.score.auto} teleop={entry.score.teleop} endgame={entry.score.endgame} scaleMax={scaleMax} />
          {(summary.counts.length > 0 || summary.toggles.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {summary.counts.map((c) => (
                <Badge key={c.label} variant="glass" className="text-[11px]">
                  {c.label} ×{c.count}
                </Badge>
              ))}
              {summary.toggles.map((t) => (
                <Badge key={t} variant="outline" className="text-[11px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {summary.incidents.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.incidents.map((i) => (
                <Badge key={i} variant="warning" className="gap-1 text-[11px]">
                  <AlertTriangle className="h-3 w-3" /> {i}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

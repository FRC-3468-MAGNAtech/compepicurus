"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Shuffle } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { ChipSummary } from "@/components/practice/chip-summary";
import { getStatus, getPercentColor } from "@/lib/accuracy/engine";
import { getEntriesForSession, type ScoutEntry } from "@/lib/scout-entries";
import { getSeason } from "@/lib/seasons";
import { cardEntranceVariants } from "@/lib/motion";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";

export function ResultsScreen({
  session,
  libraryMatch,
  onScoutAnother,
  onBackToPracticeScouting,
}: {
  session: PracticeSession;
  libraryMatch: LibraryMatch;
  onScoutAnother: () => void;
  onBackToPracticeScouting: () => void;
}) {
  const [entries, setEntries] = useState<ScoutEntry[] | null>(null);
  const season = getSeason(session.seasonId);

  useEffect(() => {
    let cancelled = false;
    getEntriesForSession(session.teamId, session.id).then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session.teamId, session.id]);

  if (!entries || session.accuracy === null) {
    return <div className="glass-card h-64 animate-pulse" />;
  }

  const robot1 = entries.find((e) => e.teamNumber === session.robots[0]) ?? entries[0];
  const robot2 = entries.find((e) => e.teamNumber === session.robots[1]) ?? entries[1];
  const accuracy = session.accuracy;
  const status = getStatus(accuracy);
  const percentColor = getPercentColor(accuracy);
  const officialAlliance = libraryMatch.alliances[session.alliance ?? "red"];
  const difference = (session.scoutedTotal ?? 0) - (session.officialScore ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <ChipSummary seasonName={season.name} mode={session.mode} difficulty={session.difficulty} />

      <motion.div variants={cardEntranceVariants} initial="hidden" animate="show">
        <GlassPanel strong className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Accuracy</span>
          <span className={`text-6xl font-bold tabular-nums ${percentColor}`}>{Math.round(accuracy)}%</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.badgeClassName}`}>{status.label}</span>
        </GlassPanel>
      </motion.div>

      <GlassPanel className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Comparison</h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label={`Team ${session.robots[0]}`} value={robot1?.score.total ?? 0} />
          <Stat label={`Team ${session.robots[1]}`} value={robot2?.score.total ?? 0} />
          <Stat label="+ Penalties" value={session.penaltyPoints ?? officialAlliance.penaltyPoints} />
          <Stat label="= Your total" value={session.scoutedTotal ?? 0} emphasize />
        </div>
        <div className="my-1 h-px bg-[var(--glass-border)]" />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label="Your total" value={session.scoutedTotal ?? 0} />
          <Stat label="Official score" value={session.officialScore ?? officialAlliance.score} />
          <Stat label="Difference" value={difference} signed />
        </div>
      </GlassPanel>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" className="gap-2" onClick={onScoutAnother}>
          <Shuffle className="h-4 w-4" /> Scout Another Match
        </Button>
        <Button size="lg" variant="glass" className="gap-2" onClick={onBackToPracticeScouting}>
          Back to Practice Scouting <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, emphasize, signed }: { label: string; value: number; emphasize?: boolean; signed?: boolean }) {
  const display = signed && value > 0 ? `+${value}` : String(value);
  return (
    <div className="glass-card flex flex-col gap-1 p-3">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <span className={emphasize ? "text-lg font-bold text-gradient" : "text-lg font-semibold"}>{display}</span>
    </div>
  );
}

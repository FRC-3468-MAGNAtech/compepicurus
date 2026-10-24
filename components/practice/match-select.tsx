"use client";

import { useMemo } from "react";
import { ChevronLeft, Shuffle, VideoOff } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChipSummary } from "@/components/practice/chip-summary";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { useLibraryMatchesBySeason } from "@/lib/match-library";
import { useTeamPracticeSessions } from "@/lib/practice-sessions";
import { buildMatchRows, pickRandomMatchRow, type MatchRow } from "@/lib/practice-match-rows";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS, type Difficulty } from "@/lib/difficulty";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { getSeason } from "@/lib/seasons";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<MatchRow["status"], { label: string; className: string }> = {
  fresh: { label: "Fresh", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30" },
  opened: { label: "Opened", className: "bg-amber-500/15 text-amber-300 border border-amber-400/30" },
  scouted: { label: "Scouted", className: "bg-sky-500/15 text-sky-300 border border-sky-400/30" },
};

export function MatchSelect({
  seasonId,
  difficulty,
  onBack,
  onStart,
}: {
  seasonId: string;
  difficulty: Difficulty;
  onBack: () => void;
  onStart: (row: MatchRow) => void;
}) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team } = useTeamDoc(teamId);
  const usePlaceholder = team?.usePlaceholderVideo ?? false;
  const { matches, loaded: matchesLoaded } = useLibraryMatchesBySeason(seasonId);
  const { sessions, loaded: sessionsLoaded } = useTeamPracticeSessions(teamId);
  const season = getSeason(seasonId);

  const rows = useMemo(
    () => (user ? buildMatchRows(matches, sessions, user.uid, difficulty) : []),
    [matches, sessions, user, difficulty]
  );
  const startable = useMemo(() => rows.filter((r) => r.hasVideo || usePlaceholder), [rows, usePlaceholder]);

  const handleRandomize = () => {
    const picked = pickRandomMatchRow(startable);
    if (picked) onStart(picked);
  };

  const loaded = matchesLoaded && sessionsLoaded;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="gap-1.5" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <ChipSummary seasonName={season.name} difficulty={difficulty} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Pick a match</h2>
        <Button className="gap-2" disabled={startable.length === 0} onClick={handleRandomize}>
          <Shuffle className="h-4 w-4" /> Randomize
        </Button>
      </div>

      {!loaded ? (
        <div className="glass-card h-48 animate-pulse" />
      ) : rows.length === 0 ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">
          No {DIFFICULTY_LABELS[difficulty].toLowerCase()} matches in the library yet &mdash; ask an admin to import one in the
          Admin Panel.
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const disabled = !row.hasVideo && !usePlaceholder;
            const status = STATUS_BADGE[row.status];
            return (
              <GlassPanel
                key={`${row.libraryMatchId}-${row.alliance}`}
                interactive={!disabled}
                onClick={() => !disabled && onStart(row)}
                className={cn("flex flex-wrap items-center gap-3 p-4", disabled && "opacity-50")}
              >
                <Badge variant="glass" className="shrink-0 font-mono">
                  {MATCH_TYPE_PREFIX[row.matchType]}
                  {row.matchNumber}
                </Badge>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    row.alliance === "red" ? "bg-red-500/15 text-red-300" : "bg-blue-500/15 text-blue-300"
                  )}
                >
                  {row.alliance}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.teams.join(" & ")}</span>
                <Badge className={DIFFICULTY_CLASSNAMES[row.difficulty]}>{DIFFICULTY_LABELS[row.difficulty]}</Badge>
                <Badge className={status.className}>
                  {status.label}
                  {row.byYou ? " · by you" : ""}
                </Badge>
                {disabled && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <VideoOff className="h-3 w-3" /> No video yet
                  </Badge>
                )}
              </GlassPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}

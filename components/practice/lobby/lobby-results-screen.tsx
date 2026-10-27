"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Shuffle, Trophy, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getStatus, getPercentColor, rankWithTies } from "@/lib/accuracy/engine";
import { cardEntranceVariants } from "@/lib/motion";
import { useLibraryMatchesBySeason } from "@/lib/match-library";
import { pickRandomLobbyMatch } from "@/lib/lobby/match-select";
import { getEntriesForSession, type ScoutEntry } from "@/lib/scout-entries";
import { updateLobby, useLobbySessions, type LobbyDoc, type LobbyPlayer, type LobbyStatus } from "@/lib/lobby";
import type { PairAssignment } from "@/lib/lobby/pairing";
import type { PracticeSession } from "@/lib/practice-sessions";

type PairResult = {
  pair: PairAssignment;
  sessions: [PracticeSession, PracticeSession];
  accuracy: number;
};

function nameFor(players: LobbyPlayer[], uid: string): string {
  return players.find((p) => p.uid === uid)?.name ?? "Unknown";
}

export function LobbyResultsScreen({
  lobby,
  players,
  isHost,
  onExit,
}: {
  lobby: LobbyDoc;
  players: LobbyPlayer[];
  isHost: boolean;
  onExit: () => void;
}) {
  const { sessions } = useLobbySessions(lobby.teamId, lobby.id);
  const { matches } = useLibraryMatchesBySeason(lobby.seasonId);
  const [detailPair, setDetailPair] = useState<PairResult | null>(null);
  const [startingAgain, setStartingAgain] = useState(false);

  const pairing = lobby.pairing ?? [];
  const complete: PairResult[] = [];
  const incomplete: PairAssignment[] = [];
  for (const pair of pairing) {
    const pairSessions = sessions.filter((s) => s.pairId === pair.pairId);
    if (pairSessions.length === 2 && pairSessions.every((s) => s.accuracy !== null)) {
      complete.push({ pair, sessions: [pairSessions[0], pairSessions[1]], accuracy: pairSessions[0].accuracy! });
    } else {
      incomplete.push(pair);
    }
  }

  const ranked = rankWithTies(complete, (r) => r.accuracy).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const winner = ranked.find((r) => r.rank === 1) ?? null;
  const rest = ranked.filter((r) => r.rank !== 1);

  const handlePlayAgain = async () => {
    setStartingAgain(true);
    try {
      const pool = matches.filter((m) => m.id !== lobby.libraryMatchId);
      const picked = pickRandomLobbyMatch(pool.length > 0 ? pool : matches);
      await updateLobby(lobby.id, {
        status: "waiting" satisfies LobbyStatus,
        libraryMatchId: picked?.id ?? null,
        pairing: null,
        startsAt: null,
        resolvedAt: null,
      });
    } finally {
      setStartingAgain(false);
    }
  };

  const handleClose = async () => {
    await updateLobby(lobby.id, { status: "closed" });
    onExit();
  };

  return (
    <div className="flex flex-col gap-4">
      {winner && (
        <motion.div variants={cardEntranceVariants} initial="hidden" animate="show">
          <GlassPanel strong className="flex flex-col items-center gap-2 py-10 text-center">
            <Trophy className="h-8 w-8 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Winner</span>
            <span className="text-lg font-bold">
              {nameFor(players, winner.item.pair.playerUids[0])} &amp; {nameFor(players, winner.item.pair.playerUids[1])}
            </span>
            <span className={`text-5xl font-bold tabular-nums ${getPercentColor(winner.item.accuracy)}`}>
              {Math.round(winner.item.accuracy)}%
            </span>
            <Badge className={getStatus(winner.item.accuracy).badgeClassName}>{getStatus(winner.item.accuracy).label}</Badge>
            <Button variant="glass" size="sm" className="mt-2" onClick={() => setDetailPair(winner.item)}>
              View breakdown
            </Button>
          </GlassPanel>
        </motion.div>
      )}

      {rest.length > 0 && (
        <GlassPanel className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Leaderboard</h2>
          <div className="flex flex-col gap-2">
            {rest.map((r) => (
              <button
                key={r.item.pair.pairId}
                type="button"
                onClick={() => setDetailPair(r.item)}
                className="glass-card flex flex-wrap items-center gap-3 p-3 text-left hover:bg-white/8"
              >
                <Badge variant="outline" className="font-mono">
                  #{r.rank}
                </Badge>
                <span className="text-sm font-medium">
                  {nameFor(players, r.item.pair.playerUids[0])} &amp; {nameFor(players, r.item.pair.playerUids[1])}
                </span>
                <span className={`ml-auto text-sm font-semibold tabular-nums ${getPercentColor(r.item.accuracy)}`}>
                  {Math.round(r.item.accuracy)}%
                </span>
              </button>
            ))}
          </div>
        </GlassPanel>
      )}

      {incomplete.length > 0 && (
        <GlassPanel className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Did not finish</h2>
          <div className="flex flex-col gap-2">
            {incomplete.map((pair) => (
              <div key={pair.pairId} className="glass-card flex items-center gap-3 p-3 opacity-70">
                <span className="text-sm">
                  {nameFor(players, pair.playerUids[0])} &amp; {nameFor(players, pair.playerUids[1])}
                </span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  Did not finish
                </Badge>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}

      <div className="flex flex-wrap gap-3">
        {isHost ? (
          <>
            <Button size="lg" className="gap-2" disabled={startingAgain} onClick={handlePlayAgain}>
              <Shuffle className="h-4 w-4" /> {startingAgain ? "Starting…" : "Play Again"}
            </Button>
            <Button size="lg" variant="glass" className="gap-2 text-red-300" onClick={handleClose}>
              <X className="h-4 w-4" /> Close Lobby
            </Button>
          </>
        ) : (
          <Button size="lg" variant="glass" className="gap-2" onClick={onExit}>
            Back to Practice Scouting <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={detailPair !== null} onOpenChange={(open) => !open && setDetailPair(null)}>
        <DialogContent>
          {detailPair && <PairDetail teamId={lobby.teamId} players={players} result={detailPair} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PairDetail({ teamId, players, result }: { teamId: string; players: LobbyPlayer[]; result: PairResult }) {
  const [entries, setEntries] = useState<ScoutEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(result.sessions.map((s) => getEntriesForSession(teamId, s.id))).then((lists) => {
      if (!cancelled) setEntries(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [teamId, result]);

  const [sessionA, sessionB] = result.sessions;
  const entryA = entries?.find((e) => e.id === sessionA.entryIds[0]);
  const entryB = entries?.find((e) => e.id === sessionB.entryIds[0]);

  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>
        {nameFor(players, sessionA.uid)} &amp; {nameFor(players, sessionB.uid)}
      </DialogTitle>
      {!entries ? (
        <div className="glass-card h-32 animate-pulse" />
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label={`Team ${sessionA.robots[0]} (${nameFor(players, sessionA.uid)})`} value={entryA?.score.total ?? 0} />
          <Stat label={`Team ${sessionB.robots[0]} (${nameFor(players, sessionB.uid)})`} value={entryB?.score.total ?? 0} />
          <Stat label="+ Penalties" value={sessionA.penaltyPoints ?? 0} />
          <Stat label="= Scouted total" value={sessionA.scoutedTotal ?? 0} emphasize />
          <Stat label="Official score" value={sessionA.officialScore ?? 0} />
          <Stat label="Difference" value={(sessionA.scoutedTotal ?? 0) - (sessionA.officialScore ?? 0)} signed />
        </div>
      )}
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

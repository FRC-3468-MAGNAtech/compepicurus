"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Crown, Play, Shuffle, VideoOff, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChipSummary } from "@/components/practice/chip-summary";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS, type Difficulty } from "@/lib/difficulty";
import { getSeason } from "@/lib/seasons";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { useLibraryMatchesBySeason, type LibraryMatch } from "@/lib/match-library";
import { pickRandomLobbyMatch, sortMatchesByDifficultyTarget } from "@/lib/lobby/match-select";
import { assignPairs } from "@/lib/lobby/pairing";
import { mulberry32, randomSeed } from "@/lib/scheduler/rng";
import { isPlayerActive, leaveLobbyPlayer, resetPlayerSubmitted, updateLobby, type LobbyDoc, type LobbyPlayer } from "@/lib/lobby";
import { LOBBY_CONFIG } from "@/lib/lobby/config";

function playable(match: LibraryMatch, usePlaceholder: boolean): boolean {
  return match.video !== null || usePlaceholder;
}

export function LobbyWaitingRoom({
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
  const { user } = useAuth();
  const { team } = useTeamDoc(lobby.teamId);
  const usePlaceholder = team?.usePlaceholderVideo ?? false;
  const { matches } = useLibraryMatchesBySeason(lobby.seasonId);
  const playableMatches = useMemo(() => matches.filter((m) => playable(m, usePlaceholder)), [matches, usePlaceholder]);
  const chosenMatch = matches.find((m) => m.id === lobby.libraryMatchId) ?? null;

  const [pickOpen, setPickOpen] = useState(false);
  const [target, setTarget] = useState<Difficulty>("easy");
  const [autoPicked, setAutoPicked] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Host's default: a random match from the whole library, any difficulty — picked once, the moment the library has loaded.
  useEffect(() => {
    if (!isHost || autoPicked || lobby.libraryMatchId || playableMatches.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoPicked(true);
    const picked = pickRandomLobbyMatch(playableMatches);
    if (picked) void updateLobby(lobby.id, { libraryMatchId: picked.id });
  }, [isHost, autoPicked, lobby.libraryMatchId, lobby.id, playableMatches]);

  // Clear a stale `submitted: true` from a previous round (including after
  // "Play Again") the moment we're back in the waiting room — otherwise the
  // next round's "everyone submitted" check would already be satisfied
  // before anyone scouts anything. Only the player themself may write this.
  const myPlayer = players.find((p) => p.uid === user?.uid) ?? null;
  useEffect(() => {
    if (user && myPlayer?.submitted) void resetPlayerSubmitted(lobby.id, user.uid);
  }, [user, myPlayer?.submitted, lobby.id]);

  const scoutingPlayers = players.filter((p) => p.uid !== lobby.hostUid || lobby.settings.hostScouts);
  const canStart = scoutingPlayers.length >= 4 && scoutingPlayers.length % 2 === 0;
  const startDisabledReason = !chosenMatch
    ? "Waiting on a match to be chosen."
    : scoutingPlayers.length < 4
      ? "Need an even number of players, at least 4."
      : scoutingPlayers.length % 2 !== 0
        ? "Need an even number of players, at least 4."
        : null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(lobby.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — the code is still shown on screen.
    }
  };

  const handleStart = async () => {
    if (!canStart || !chosenMatch) return;
    setStarting(true);
    setError(null);
    try {
      const allianceTeams = {
        red: chosenMatch.alliances.red.teams as [number, number],
        blue: chosenMatch.alliances.blue.teams as [number, number],
      };
      const pairing = assignPairs(
        scoutingPlayers.map((p) => p.uid),
        allianceTeams,
        mulberry32(randomSeed())
      );
      await updateLobby(lobby.id, {
        status: "scouting",
        pairing,
        startsAt: new Date(Date.now() + LOBBY_CONFIG.COUNTDOWN_SEC * 1000).toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the round.");
    } finally {
      setStarting(false);
    }
  };

  const handleClose = async () => {
    await updateLobby(lobby.id, { status: "closed" });
    onExit();
  };

  const handleLeave = async () => {
    if (!user) return;
    await leaveLobbyPlayer(lobby.id, user.uid);
    onExit();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipSummary seasonName={getSeason(lobby.seasonId).name} mode={lobby.mode} />
        <Button variant="ghost" size="sm" className="gap-1.5 text-red-300" onClick={isHost ? handleClose : handleLeave}>
          <X className="h-4 w-4" /> {isHost ? "Close Lobby" : "Leave"}
        </Button>
      </div>

      <GlassPanel strong className="flex flex-wrap items-center justify-between gap-3 py-6 text-center">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Join code</div>
          <div className="font-mono text-3xl font-bold tracking-wider">{lobby.id}</div>
        </div>
        <Button variant="glass" className="gap-2" onClick={handleCopyCode}>
          <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy"}
        </Button>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Match</h2>
        {chosenMatch ? (
          <div className="glass-card flex flex-wrap items-center gap-3 p-4">
            <Badge variant="glass" className="font-mono">
              {chosenMatch.matchType} {chosenMatch.matchNumber}
            </Badge>
            <Badge className={DIFFICULTY_CLASSNAMES[chosenMatch.alliances.red.difficulty]}>
              Red {DIFFICULTY_LABELS[chosenMatch.alliances.red.difficulty]}
            </Badge>
            <Badge className={DIFFICULTY_CLASSNAMES[chosenMatch.alliances.blue.difficulty]}>
              Blue {DIFFICULTY_LABELS[chosenMatch.alliances.blue.difficulty]}
            </Badge>
            {!chosenMatch.video && !usePlaceholder && (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <VideoOff className="h-3.5 w-3.5" /> No video
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">Picking a random match…</p>
        )}
        {isHost && (
          <Button variant="glass" size="sm" className="gap-2 self-start" onClick={() => setPickOpen(true)}>
            <Shuffle className="h-4 w-4" /> Pick Match
          </Button>
        )}
      </GlassPanel>

      {isHost && (
        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Host options</h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">I&apos;ll scout too</div>
              <div className="text-xs text-[var(--muted-foreground)]">Off = you only run the lobby, not counted as a player.</div>
            </div>
            <Switch
              checked={lobby.settings.hostScouts}
              onCheckedChange={(checked) => void updateLobby(lobby.id, { settings: { ...lobby.settings, hostScouts: checked } })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">I&apos;m the video displayer</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                On = your screen shows the video large for everyone; others see only the form.
              </div>
            </div>
            <Switch
              checked={lobby.settings.hostIsDisplayer}
              onCheckedChange={(checked) => void updateLobby(lobby.id, { settings: { ...lobby.settings, hostIsDisplayer: checked } })}
            />
          </div>
        </GlassPanel>
      )}

      <GlassPanel className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Players ({scoutingPlayers.length} scouting)
        </h2>
        <div className="flex flex-col gap-2">
          {players.map((p) => (
            <div key={p.uid} className="glass-card flex items-center gap-3 p-3">
              {p.uid === lobby.hostUid && <Crown className="h-4 w-4 text-amber-400" />}
              <span className="text-sm font-medium">{p.name}</span>
              {p.uid === lobby.hostUid && !lobby.settings.hostScouts && (
                <Badge variant="outline" className="text-[10px]">
                  Not scouting
                </Badge>
              )}
              <Badge variant={isPlayerActive(p.lastSeen) ? "success" : "outline"} className="ml-auto text-[10px]">
                {isPlayerActive(p.lastSeen) ? "Connected" : "Disconnected"}
              </Badge>
            </div>
          ))}
          {players.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">Waiting for players to join…</p>}
        </div>
      </GlassPanel>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {isHost ? (
        <div className="flex flex-col gap-2">
          <Button size="lg" className="gap-2 self-start" disabled={!canStart || starting} onClick={handleStart}>
            <Play className="h-4 w-4" /> {starting ? "Starting…" : "Start"}
          </Button>
          {startDisabledReason && <p className="text-xs text-[var(--muted-foreground)]">{startDisabledReason}</p>}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">Waiting for the host to start the round…</p>
      )}

      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle>Pick Match</DialogTitle>
          <DialogDescription>Sorted by closest to your target difficulty. Scores stay hidden.</DialogDescription>
          <div className="mt-2">
            <Select value={target} onValueChange={(v) => setTarget(v as Difficulty)}>
              <SelectTrigger>
                <SelectValue>{DIFFICULTY_LABELS[target]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIFFICULTY_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto">
            {sortMatchesByDifficultyTarget(playableMatches, target).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  void updateLobby(lobby.id, { libraryMatchId: m.id });
                  setPickOpen(false);
                }}
                className="glass-card flex items-center gap-2 p-3 text-left hover:bg-white/8"
              >
                <Badge variant="glass" className="font-mono">
                  {m.matchType} {m.matchNumber}
                </Badge>
                <Badge className={DIFFICULTY_CLASSNAMES[m.alliances.red.difficulty]}>
                  Red {DIFFICULTY_LABELS[m.alliances.red.difficulty]}
                </Badge>
                <Badge className={DIFFICULTY_CLASSNAMES[m.alliances.blue.difficulty]}>
                  Blue {DIFFICULTY_LABELS[m.alliances.blue.difficulty]}
                </Badge>
              </button>
            ))}
            {playableMatches.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No playable matches yet.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

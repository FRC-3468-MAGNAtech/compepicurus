"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { LobbyWaitingRoom } from "@/components/practice/lobby/lobby-waiting-room";
import { LobbySessionScreen } from "@/components/practice/lobby/lobby-session-screen";
import { LobbyResultsScreen } from "@/components/practice/lobby/lobby-results-screen";
import { useAuth } from "@/lib/auth";
import { claimLobbyId, heartbeatHost, heartbeatPlayer, joinLobby, useLobby, useLobbyPlayers } from "@/lib/lobby";
import { LOBBY_CONFIG } from "@/lib/lobby/config";
import type { SessionMode } from "@/lib/practice-sessions";

export function LobbyFlow({
  seasonId,
  mode,
  lobbyId: initialLobbyId,
  onExit,
}: {
  /** Required to host a fresh lobby — not needed when `lobbyId` is already given (a joiner inherits the lobby's own season/mode). */
  seasonId?: string | null;
  mode?: Exclude<SessionMode, null> | null;
  /** Already known — "Join with code" on the landing page, or a "Rejoin" banner. Skips straight to the room. */
  lobbyId?: string;
  onExit: () => void;
}) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;

  const [lobbyId, setLobbyId] = useState<string | null>(initialLobbyId ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const { lobby, loaded } = useLobby(lobbyId);
  const { players } = useLobbyPlayers(lobbyId);
  const isHost = Boolean(user && lobby && user.uid === lobby.hostUid);

  // Ensure our own player doc exists the moment a lobby is known, whether
  // we just created it (as host) or arrived here with an already-known
  // lobbyId (joined by code, or a reconnect) — one join path either way.
  useEffect(() => {
    if (!lobbyId || !teamId || !user || !profile || joined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJoined(true);
    void joinLobby(lobbyId, teamId, user.uid, profile.name);
  }, [lobbyId, teamId, user, profile, joined]);

  // One heartbeat loop for the whole time this lobby room is open,
  // regardless of which status screen is showing — the host writes
  // `hostLastSeen` (their own lobby-doc write, allowed by rules); every
  // joined player writes their own `players/{uid}.lastSeen`.
  useEffect(() => {
    if (!lobbyId || !user || !joined || lobby?.status === "closed") return;
    const write = () => {
      void heartbeatPlayer(lobbyId, user.uid);
      if (isHost) void heartbeatHost(lobbyId);
    };
    write();
    const interval = setInterval(write, LOBBY_CONFIG.HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [lobbyId, user, joined, isHost, lobby?.status]);

  const handleHost = async () => {
    if (!teamId || !user || !profile || !seasonId || !mode) return;
    setCreating(true);
    setError(null);
    try {
      const id = await claimLobbyId(teamId, user.uid, profile.name, seasonId, mode);
      setLobbyId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a lobby.");
    } finally {
      setCreating(false);
    }
  };

  if (!lobbyId) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="gap-1.5" onClick={onExit}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
        </div>
        <GlassPanel className="flex flex-col items-center gap-4 py-10 text-center">
          <Users className="h-8 w-8 text-[var(--color-primary)]" />
          <h2 className="text-lg font-bold">Host a Live Practice Lobby</h2>
          <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
            Everyone scouts the same match at once, in pairs — results show a winner and a leaderboard, like Kahoot.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button size="lg" disabled={creating} onClick={handleHost}>
            {creating ? "Creating…" : "Host a Lobby"}
          </Button>
        </GlassPanel>
      </div>
    );
  }

  if (!loaded) return <div className="glass-card h-64 animate-pulse" />;

  if (!lobby) {
    return (
      <div className="flex flex-col gap-4">
        <GlassPanel className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            That lobby code doesn&apos;t match anything on your team — double-check it and try again.
          </p>
          <Button variant="glass" onClick={onExit}>
            Back
          </Button>
        </GlassPanel>
      </div>
    );
  }

  if (lobby.status === "closed") {
    return (
      <div className="flex flex-col gap-4">
        <GlassPanel className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">This lobby has been closed.</p>
          <Button variant="glass" onClick={onExit}>
            Back to Practice Scouting
          </Button>
        </GlassPanel>
      </div>
    );
  }

  if (lobby.status === "waiting") {
    return <LobbyWaitingRoom lobby={lobby} players={players} isHost={isHost} onExit={onExit} />;
  }

  if (lobby.status === "scouting") {
    return <LobbySessionScreen lobby={lobby} players={players} isHost={isHost} onExit={onExit} />;
  }

  return <LobbyResultsScreen lobby={lobby} players={players} isHost={isHost} onExit={onExit} />;
}

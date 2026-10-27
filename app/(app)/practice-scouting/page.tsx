"use client";

import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipSummary } from "@/components/practice/chip-summary";
import { ResumeBanner } from "@/components/practice/resume-banner";
import { SeasonSelect } from "@/components/practice/season-select";
import { ModeSelect } from "@/components/practice/mode-select";
import { DifficultySelect } from "@/components/practice/difficulty-select";
import { MatchSelect } from "@/components/practice/match-select";
import { SessionScreen } from "@/components/practice/session-screen";
import { ResultsScreen } from "@/components/practice/results-screen";
import { LiveFlow, type ResumePendingRobot } from "@/components/practice/live/live-flow";
import { PresencePanel } from "@/components/practice/live/presence-panel";
import { PendingRobotsList } from "@/components/practice/live/pending-robots-list";
import { LobbyFlow } from "@/components/practice/lobby/lobby-flow";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { detectPlatform } from "@/lib/platform";
import { getSeason } from "@/lib/seasons";
import { useLibraryMatchesBySeason } from "@/lib/match-library";
import { useMyActiveLobbyId } from "@/lib/lobby";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchRow } from "@/lib/practice-match-rows";
import {
  claimSessionId,
  updatePracticeSession,
  useOwnPausedSession,
  usePracticeSession,
  useTeamLiveSessions,
  type PracticeSession,
  type SessionMode,
} from "@/lib/practice-sessions";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Step = "season" | "mode" | "difficulty" | "match-select" | "session" | "results" | "live" | "lobby";

/** Accepts the join code with or without its "LB-" prefix, case-insensitively. */
function normalizeLobbyCode(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  return trimmed.startsWith("LB-") ? trimmed : `LB-${trimmed}`;
}

export default function PracticeScoutingPage() {
  const { user, profile, loading } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team } = useTeamDoc(teamId);
  const usePlaceholder = team?.usePlaceholderVideo ?? false;

  const { session: pausedSession, loaded: pausedLoaded } = useOwnPausedSession(teamId, user?.uid ?? null);
  const { sessions: liveSessions } = useTeamLiveSessions(teamId);
  const myRecentLiveSessions = liveSessions
    .filter((s) => s.uid === user?.uid && s.status === "completed")
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))
    .slice(0, 5);

  const [step, setStep] = useState<Step>("season");
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveResumeTarget, setLiveResumeTarget] = useState<ResumePendingRobot | undefined>(undefined);
  const [liveViewResultsId, setLiveViewResultsId] = useState<string | undefined>(undefined);
  const [lobbyId, setLobbyId] = useState<string | undefined>(undefined);
  const [joinCode, setJoinCode] = useState("");

  const { lobbyId: myActiveLobbyId } = useMyActiveLobbyId(user?.uid ?? null);

  const { session: activeSession } = usePracticeSession(activeSessionId);
  const { matches: activeSeasonMatches } = useLibraryMatchesBySeason(activeSession?.seasonId ?? null);
  const activeLibraryMatch = useMemo(
    () => activeSeasonMatches.find((m) => m.id === activeSession?.libraryMatchId) ?? null,
    [activeSeasonMatches, activeSession]
  );

  const handleResume = (session: PracticeSession) => {
    setSeasonId(session.seasonId);
    setMode(session.mode);
    setDifficulty(session.difficulty);
    setActiveSessionId(session.id);
    setStep("session");
  };

  const claimAndStart = async (row: MatchRow) => {
    if (claiming || !user || !teamId || !profile || !seasonId || !mode || !difficulty) return;
    setClaiming(true);
    setError(null);
    try {
      const sessionId = await claimSessionId(teamId, user.uid, "solo");
      await updatePracticeSession(sessionId, {
        scoutName: profile.name,
        seasonId,
        mode,
        difficulty,
        libraryMatchId: row.libraryMatchId,
        eventCode: row.eventCode,
        alliance: row.alliance,
        robots: row.teams,
        completedRobots: [],
        entryIds: [],
        accuracy: null,
        scoutedTotal: null,
        penaltyPoints: null,
        officialScore: null,
        platform: detectPlatform(),
        flags: [],
        excluded: false,
        lobbyId: null,
        pairId: null,
        finishedAt: null,
      });
      setActiveSessionId(sessionId);
      setStep("session");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start that session.");
    } finally {
      setClaiming(false);
    }
  };

  const handleExitToMatchSelect = () => {
    setActiveSessionId(null);
    setStep("match-select");
  };

  const handlePaused = () => {
    setActiveSessionId(null);
    setStep("season");
  };

  const handleScoutAnother = () => {
    setActiveSessionId(null);
    setStep("match-select");
  };

  const handleBackToLanding = () => {
    setActiveSessionId(null);
    setSeasonId(null);
    setMode(null);
    setDifficulty(null);
    setStep("season");
  };

  if (loading || !pausedLoaded) {
    return <div className="glass-card h-64 animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      {step === "season" && (
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Practice Scouting</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Scout recorded matches solo, on your own time &mdash; Trial to practice, Competitive for the real pressure.
            </p>
          </div>
          <PresencePanel
            teamId={teamId}
            onJoin={(target) => {
              setLiveResumeTarget(target);
              setStep("live");
            }}
          />
          <PendingRobotsList
            onStart={(target) => {
              setLiveResumeTarget(target);
              setStep("live");
            }}
          />
          {myActiveLobbyId && (
            <GlassPanel className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm">You&apos;re still in a Live Practice Lobby.</span>
              <Button
                size="sm"
                onClick={() => {
                  setLobbyId(myActiveLobbyId);
                  setStep("lobby");
                }}
              >
                Rejoin
              </Button>
            </GlassPanel>
          )}
          <GlassPanel className="flex flex-wrap items-center gap-3">
            <Input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Join code (e.g. LB-7K3PQR)"
              className="max-w-xs"
            />
            <Button
              variant="glass"
              onClick={() => {
                if (!joinCode.trim()) return;
                setLobbyId(normalizeLobbyCode(joinCode));
                setStep("lobby");
              }}
            >
              Join Lobby
            </Button>
          </GlassPanel>
          {myRecentLiveSessions.length > 0 && (
            <GlassPanel className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Recent live matches</h2>
              <div className="flex flex-col gap-2">
                {myRecentLiveSessions.map((s) => (
                  <div key={s.id} className="glass-card flex flex-wrap items-center gap-3 p-3">
                    <Badge variant="glass" className="font-mono">
                      {s.matchType} {s.matchNumber}
                    </Badge>
                    <span className="text-sm text-[var(--muted-foreground)]">Team {s.robots[0]}</span>
                    <Badge variant={s.accuracy !== null ? "success" : "outline"} className="text-[10px]">
                      {s.accuracy !== null ? "Scored" : "Waiting for scores"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => {
                        setLiveViewResultsId(s.id);
                        setLiveResumeTarget(undefined);
                        setStep("live");
                      }}
                    >
                      View Results
                    </Button>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}
          {pausedSession ? (
            <>
              <ResumeBanner session={pausedSession} onResume={() => handleResume(pausedSession)} onDiscarded={() => {}} />
              <p className="text-sm text-[var(--muted-foreground)]">
                Finish or discard your paused session before starting a new one.
              </p>
            </>
          ) : (
            <SeasonSelect
              onSelect={(id) => {
                setSeasonId(id);
                setStep("mode");
              }}
            />
          )}
        </>
      )}

      {step === "mode" && seasonId && (
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="gap-1.5" onClick={() => setStep("season")}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <ChipSummary seasonName={getSeason(seasonId).name} />
          </div>
          <ModeSelect
            onSelect={(m) => {
              setMode(m);
              setStep("difficulty");
            }}
          />
        </>
      )}

      {step === "difficulty" && seasonId && mode && (
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="gap-1.5" onClick={() => setStep("mode")}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <ChipSummary seasonName={getSeason(seasonId).name} mode={mode} />
          </div>
          <DifficultySelect
            onSelect={(d) => {
              setDifficulty(d);
              setStep("match-select");
            }}
            onSelectLive={() => {
              setLiveResumeTarget(undefined);
              setLiveViewResultsId(undefined);
              setStep("live");
            }}
            onSelectLobby={() => {
              setLobbyId(undefined);
              setStep("lobby");
            }}
          />
        </>
      )}

      {step === "live" && (
        <LiveFlow
          onExit={() => {
            setLiveResumeTarget(undefined);
            setLiveViewResultsId(undefined);
            setStep("season");
          }}
          resumePendingRobot={liveResumeTarget}
          viewResultsSessionId={liveViewResultsId}
        />
      )}

      {step === "lobby" && (
        <LobbyFlow
          seasonId={seasonId}
          mode={mode}
          lobbyId={lobbyId}
          onExit={() => {
            setLobbyId(undefined);
            setJoinCode("");
            setStep("season");
          }}
        />
      )}

      {step === "match-select" && seasonId && difficulty && (
        <>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <MatchSelect seasonId={seasonId} difficulty={difficulty} onBack={() => setStep("difficulty")} onStart={claimAndStart} />
          {claiming && <p className="text-sm text-[var(--muted-foreground)]">Starting session&hellip;</p>}
        </>
      )}

      {step === "session" &&
        (activeSession && activeLibraryMatch ? (
          <SessionScreen
            session={activeSession}
            libraryMatch={activeLibraryMatch}
            usePlaceholder={usePlaceholder}
            onExitToMatchSelect={handleExitToMatchSelect}
            onPaused={handlePaused}
            onCompleted={() => setStep("results")}
          />
        ) : (
          <div className="glass-card h-64 animate-pulse" />
        ))}

      {step === "results" &&
        (activeSession && activeLibraryMatch ? (
          <ResultsScreen
            session={activeSession}
            libraryMatch={activeLibraryMatch}
            onScoutAnother={handleScoutAnother}
            onBackToPracticeScouting={handleBackToLanding}
          />
        ) : (
          <div className="glass-card h-64 animate-pulse" />
        ))}
    </div>
  );
}

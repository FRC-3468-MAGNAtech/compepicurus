"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScoutForm, type ScoutFormHandle } from "@/components/scout/scout-form";
import { VideoPlayer } from "@/components/video/video-player";
import { MOCK_VIDEO_DURATION_SEC } from "@/components/video/mock-video-player";
import { ChipSummary } from "@/components/practice/chip-summary";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { detectPlatform } from "@/lib/platform";
import { useLibraryMatchesBySeason } from "@/lib/match-library";
import { BIOBUZZ_FORM_SCHEMA, calculateScore, valuesToScoutEntryFields } from "@/lib/scout-form/schema";
import { claimSessionId, updatePracticeSession } from "@/lib/practice-sessions";
import { getEntriesForSession, saveEntry } from "@/lib/scout-entries";
import { markPlayerSubmitted, useLobbySessions, type LobbyDoc, type LobbyPlayer } from "@/lib/lobby";
import { LOBBY_CONFIG } from "@/lib/lobby/config";

async function triggerResolve(lobbyId: string): Promise<void> {
  try {
    await fetch("/api/lobby/resolve-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lobbyId }),
    });
  } catch {
    // Best-effort — another open client, the host's "End Scouting," or the
    // deadline check below will still resolve it.
  }
}

export function LobbySessionScreen({
  lobby,
  players,
  isHost,
}: {
  lobby: LobbyDoc;
  players: LobbyPlayer[];
  isHost: boolean;
  /** Not used here — this screen only ever transitions via the lobby's own `status`, not a manual exit — kept so callers can pass the same prop shape as the other lobby screens. */
  onExit: () => void;
}) {
  const { user, profile } = useAuth();
  const { team } = useTeamDoc(lobby.teamId);
  const usePlaceholder = team?.usePlaceholderVideo ?? false;
  const { matches } = useLibraryMatchesBySeason(lobby.seasonId);
  const chosenMatch = matches.find((m) => m.id === lobby.libraryMatchId) ?? null;
  const { sessions } = useLobbySessions(lobby.teamId, lobby.id);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const resolveTriggered = useRef(false);
  const scoutFormRef = useRef<ScoutFormHandle>(null);

  const myPair = lobby.pairing?.find((p) => user && p.playerUids.includes(user.uid)) ?? null;
  const myRobot = myPair && user ? myPair.robotForUid[user.uid] : null;
  const mySession = sessions.find((s) => user && s.uid === user.uid) ?? null;

  // Tick for the countdown / deadline checks below.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Claim (or, on reconnect, reuse) this player's own session the moment
  // we know our pairing — mirrors solo/live's claim-then-fill pattern.
  useEffect(() => {
    if (!myPair || !myRobot || !user || !profile || claiming || sessionId) return;
    if (mySession) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionId(mySession.id);
      return;
    }
    setClaiming(true);
    (async () => {
      try {
        const id = await claimSessionId(lobby.teamId, user.uid, "lobby");
        await updatePracticeSession(id, {
          scoutName: profile.name,
          seasonId: lobby.seasonId,
          mode: lobby.mode,
          difficulty: null,
          libraryMatchId: lobby.libraryMatchId,
          eventCode: chosenMatch?.eventCode ?? null,
          matchType: chosenMatch?.matchType ?? null,
          matchNumber: chosenMatch?.matchNumber ?? null,
          alliance: myPair.alliance,
          robots: [myRobot],
          allianceTeams: chosenMatch
            ? (chosenMatch.alliances[myPair.alliance].teams as [number, number])
            : null,
          completedRobots: [],
          entryIds: [],
          accuracy: null,
          scoutedTotal: null,
          penaltyPoints: null,
          officialScore: null,
          platform: detectPlatform(),
          flags: [],
          excluded: false,
          lobbyId: lobby.id,
          pairId: myPair.pairId,
          finishedAt: null,
          streamUrl: null,
          streamStartSec: null,
          streamEndSec: null,
        });
        setSessionId(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't start your session.");
      } finally {
        setClaiming(false);
      }
    })();
  }, [myPair, myRobot, user, profile, claiming, sessionId, mySession, lobby, chosenMatch]);

  const scoutingUids = new Set(lobby.pairing?.flatMap((p) => p.playerUids) ?? []);
  const scoutingPlayers = players.filter((p) => scoutingUids.has(p.uid));
  const submittedCount = scoutingPlayers.filter((p) => p.submitted).length;
  const allSubmitted = scoutingPlayers.length > 0 && submittedCount === scoutingPlayers.length;

  const videoDurationSec = chosenMatch?.video ? chosenMatch.video.endSec - chosenMatch.video.startSec : MOCK_VIDEO_DURATION_SEC;
  const deadlineMs = lobby.startsAt
    ? new Date(lobby.startsAt).getTime() + videoDurationSec * 1000 + LOBBY_CONFIG.RESULTS_GRACE_AFTER_VIDEO_END_MS
    : null;
  const pastDeadline = deadlineMs !== null && now > deadlineMs;

  // Any open client auto-resolves once everyone's submitted, or the grace
  // deadline passes — whichever comes first. Idempotent server-side either way.
  useEffect(() => {
    if (resolveTriggered.current || lobby.status !== "scouting") return;
    if (allSubmitted || pastDeadline) {
      resolveTriggered.current = true;
      void triggerResolve(lobby.id);
    }
  }, [allSubmitted, pastDeadline, lobby.status, lobby.id]);

  const countdownMs = lobby.startsAt ? new Date(lobby.startsAt).getTime() - now : 0;
  const countingDown = countdownMs > 0;

  const handleSubmit = async () => {
    const handle = scoutFormRef.current;
    if (!handle || !handle.validate() || !mySession || !user || !myRobot) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    setSubmitting(true);
    setError(null);
    try {
      const values = handle.getValues();
      const score = calculateScore(BIOBUZZ_FORM_SCHEMA, values.fields);
      await saveEntry(lobby.teamId, user.uid, {
        scoutName: mySession.scoutName,
        eventCode: mySession.eventCode!,
        matchType: mySession.matchType!,
        matchNumber: mySession.matchNumber!,
        teamNumber: myRobot,
        fields: valuesToScoutEntryFields(values.fields),
        score,
        comments: String(values.fields.comments ?? ""),
        source: "practice",
        mode: lobby.mode,
        sessionId: mySession.id,
        libraryMatchId: lobby.libraryMatchId,
      });
      const entries = await getEntriesForSession(lobby.teamId, mySession.id);
      await updatePracticeSession(mySession.id, {
        status: "completed",
        completedRobots: [myRobot],
        entryIds: entries.map((e) => e.id),
        finishedAt: new Date().toISOString(),
      });
      await markPlayerSubmitted(lobby.id, user.uid);
      void triggerResolve(lobby.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit that entry.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndScouting = async () => {
    setEnding(true);
    try {
      await triggerResolve(lobby.id);
    } finally {
      setEnding(false);
    }
  };

  const showVideo = !lobby.settings.hostIsDisplayer || isHost;
  const alreadySubmitted = mySession?.status === "completed";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipSummary seasonName={chosenMatch?.eventName} mode={lobby.mode} />
        {chosenMatch && (
          <Badge variant="glass" className="font-mono">
            {chosenMatch.matchType} {chosenMatch.matchNumber}
          </Badge>
        )}
        <span className="text-xs text-[var(--muted-foreground)]">
          {submittedCount}/{scoutingPlayers.length} submitted
        </span>
        {isHost && (
          <Button variant="ghost" size="sm" className="text-red-300" disabled={ending} onClick={handleEndScouting}>
            {ending ? "Ending…" : "End Scouting"}
          </Button>
        )}
      </div>

      {countingDown && (
        <GlassPanel strong className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Starting in</span>
          <span className="text-5xl font-bold tabular-nums">{Math.ceil(countdownMs / 1000)}</span>
          {myPair && myRobot && (
            <p className="text-sm text-[var(--muted-foreground)]">
              You&apos;re on Team {myRobot} (<span className={myPair.alliance === "red" ? "text-red-300" : "text-blue-300"}>{myPair.alliance}</span>)
            </p>
          )}
        </GlassPanel>
      )}

      {!countingDown && !myPair && (
        <GlassPanel className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            {isHost ? "You're running the lobby — not scouting this round." : "You weren't paired this round."}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">Waiting for every scouting player to submit…</p>
        </GlassPanel>
      )}

      {!countingDown && myPair && myRobot && (
        <>
          {alreadySubmitted ? (
            <GlassPanel className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm font-medium">Submitted — nice work.</p>
              <p className="text-xs text-[var(--muted-foreground)]">Waiting on the rest of the lobby to finish…</p>
            </GlassPanel>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row">
              {showVideo && (
                <div className="lg:w-[58%] lg:shrink-0">
                  <VideoPlayer video={chosenMatch?.video ?? null} usePlaceholder={usePlaceholder} lockPause={lobby.mode === "competitive"} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <ScoutForm
                  ref={scoutFormRef}
                  mode="lobby"
                  layout="side-panel"
                  hideMatchPicker
                  showSubmitButton={false}
                  lockedFields={["teamNumber"]}
                  prefill={{ teamNumber: myRobot, scoutName: profile?.name ?? "" }}
                />
                {validationError && <p className="mt-2 text-sm font-medium text-red-300">Fill in the form before submitting.</p>}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          {!alreadySubmitted && (
            <div className="glass-strong sticky bottom-3 z-20 mt-2 flex items-center justify-end gap-3 rounded-full px-5 py-3 shadow-2xl">
              <Button size="lg" className="gap-2" onClick={handleSubmit} disabled={submitting || !mySession}>
                <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

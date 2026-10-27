"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Radio } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LiveSessionScreen } from "@/components/practice/live/live-session-screen";
import { LiveResultsScreen } from "@/components/practice/live/live-results-screen";
import { useAuth } from "@/lib/auth";
import { useActiveEvent } from "@/lib/active-event";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import { getEvents, getMatchesForEvent } from "@/lib/ftc/actions";
import { getDefaultSeason } from "@/lib/ftc/config";
import { parseStreamUrl } from "@/lib/live/stream";
import { determineJoinOption, type CoveredRobot } from "@/lib/live/join-rules";
import { liveMatchKey, useLiveMatchScouts } from "@/lib/live-presence";
import { useTeamLiveSessions, claimSessionId, updatePracticeSession, usePracticeSession, type AllianceColor } from "@/lib/practice-sessions";
import { getSeason } from "@/lib/seasons";
import { useLibraryMatches } from "@/lib/match-library";
import type { FtcEvent, FtcMatch, MatchType } from "@/lib/ftc/types";

type LiveStep = "link" | "event" | "match" | "robot" | "session" | "results";
type Roster = { red: [number, number]; blue: [number, number] };
export type ResumePendingRobot = {
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  alliance: AllianceColor;
  teamNumber: number;
  allianceTeams: [number, number];
  streamUrl: string | null;
};

export function LiveFlow({
  onExit,
  viewResultsSessionId,
  resumePendingRobot,
}: {
  onExit: () => void;
  /** Jumps straight to the results screen for an already-completed session — "View Results" from the landing page's history list. */
  viewResultsSessionId?: string;
  /** Skips the link/event/match/robot steps entirely and claims a new session with these already-known parameters — "scout this pending robot now." */
  resumePendingRobot?: ResumePendingRobot;
}) {
  const { user, profile } = useAuth();
  const { activeEvent } = useActiveEvent();
  const teamId = profile?.teamId ?? null;
  const season = activeEvent?.season ?? getDefaultSeason();

  const [step, setStep] = useState<LiveStep>(() => (viewResultsSessionId ? "results" : "link"));
  const [streamUrl, setStreamUrl] = useState(resumePendingRobot?.streamUrl ?? "");
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectedConfident, setDetectedConfident] = useState(false);
  const [event, setEvent] = useState<FtcEvent | null>(null);
  const [matchType, setMatchType] = useState<MatchType>(resumePendingRobot?.matchType ?? "Qualification");
  const [matchNumber, setMatchNumber] = useState<number | null>(resumePendingRobot?.matchNumber ?? null);
  const [manualRoster, setManualRoster] = useState<Roster | null>(null);
  const [alliance, setAlliance] = useState<AllianceColor | null>(resumePendingRobot?.alliance ?? null);
  const [teamNumber, setTeamNumber] = useState<number | null>(resumePendingRobot?.teamNumber ?? null);
  const [sessionId, setSessionId] = useState<string | null>(viewResultsSessionId ?? null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeHandled, setResumeHandled] = useState(false);

  const eventsQuery = useFtcQuery(`live-events:${season}`, () => getEvents({ season }));
  const qualQuery = useFtcQuery(event ? `live-matches:${event.code}:Q:${season}` : null, () => getMatchesForEvent(event!.code, "Qualification", season));
  const playoffQuery = useFtcQuery(event ? `live-matches:${event.code}:F:${season}` : null, () => getMatchesForEvent(event!.code, "Playoff", season));
  const { matches: libraryMatches } = useLibraryMatches(event?.code ?? null);

  const { session } = usePracticeSession(sessionId);
  const matchKey = event && matchNumber !== null ? liveMatchKey(event.code, matchType, matchNumber) : null;
  const { scouts: presence } = useLiveMatchScouts(matchKey);
  const { sessions: teamLiveSessions } = useTeamLiveSessions(teamId);

  const matches: FtcMatch[] = matchType === "Qualification" ? (qualQuery.data ?? []) : (playoffQuery.data ?? []);
  const officialMatch = matches.find((m) => m.matchNumber === matchNumber) ?? null;
  const roster: Roster | null =
    officialMatch && officialMatch.redTeams.length === 2 && officialMatch.blueTeams.length === 2
      ? { red: [officialMatch.redTeams[0], officialMatch.redTeams[1]], blue: [officialMatch.blueTeams[0], officialMatch.blueTeams[1]] }
      : manualRoster;

  const playedMatchNumbers = matches.filter((m) => m.played).map((m) => m.matchNumber);
  const suggestedMatchNumber = playedMatchNumbers.length > 0 ? Math.max(...playedMatchNumbers) + 1 : matches.length > 0 ? 1 : null;

  const handleDetect = async () => {
    setDetecting(true);
    setDetectError(null);
    try {
      const res = await fetch("/api/live/detect-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: streamUrl, season }),
      });
      const json = await res.json();
      if (json.detected) {
        setEvent(json.detected.event);
        setDetectedConfident(json.detected.confident);
      } else {
        setEvent(activeEvent ?? null);
        setDetectedConfident(false);
      }
    } catch {
      setEvent(activeEvent ?? null);
      setDetectedConfident(false);
    } finally {
      setDetecting(false);
      setStep("event");
    }
  };

  const coveredRobots: CoveredRobot[] = useMemo(() => {
    if (!matchKey || !teamId) return [];
    const activeTeamNumbers = presence.filter((p) => p.teamId === teamId).map((p) => ({ teamNumber: p.robot, alliance: p.alliance }));
    const completed = teamLiveSessions
      .filter((s) => s.status === "completed" && s.eventCode === event?.code && s.matchType === matchType && s.matchNumber === matchNumber)
      .map((s) => ({ teamNumber: s.robots[0], alliance: s.alliance! }));
    return [...activeTeamNumbers, ...completed];
  }, [presence, teamLiveSessions, matchKey, teamId, event, matchType, matchNumber]);

  const joinOption = roster ? determineJoinOption(coveredRobots, roster.red, roster.blue) : { kind: "none" as const };

  const handleClaimAndStart = async (overrides?: ResumePendingRobot) => {
    const effective = overrides ?? (event && matchNumber !== null && alliance && teamNumber && roster
      ? { eventCode: event.code, matchType, matchNumber, alliance, teamNumber, allianceTeams: alliance === "red" ? roster.red : roster.blue, streamUrl }
      : null);
    if (!teamId || !user || !profile || !effective) return;
    setClaiming(true);
    setError(null);
    try {
      const newSessionId = await claimSessionId(teamId, user.uid, "live");
      const libraryMatch = libraryMatches.find((m) => m.matchType === effective.matchType && m.matchNumber === effective.matchNumber);
      await updatePracticeSession(newSessionId, {
        scoutName: profile.name,
        seasonId: getSeason().id,
        mode: null,
        difficulty: null,
        libraryMatchId: libraryMatch?.id ?? null,
        eventCode: effective.eventCode,
        matchType: effective.matchType,
        matchNumber: effective.matchNumber,
        alliance: effective.alliance,
        robots: [effective.teamNumber],
        allianceTeams: effective.allianceTeams,
        completedRobots: [],
        entryIds: [],
        accuracy: null,
        scoutedTotal: null,
        penaltyPoints: null,
        officialScore: null,
        platform: "pc",
        flags: [],
        excluded: false,
        lobbyId: null,
        pairId: null,
        finishedAt: null,
        streamUrl: effective.streamUrl ?? "",
        streamStartSec: null,
        streamEndSec: null,
      });
      setSessionId(newSessionId);
      setStep("session");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start that session.");
    } finally {
      setClaiming(false);
    }
  };

  useEffect(() => {
    if (resumePendingRobot && !resumeHandled && !claiming && teamId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResumeHandled(true);
      void handleClaimAndStart(resumePendingRobot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumePendingRobot, resumeHandled, claiming, teamId]);

  if (resumePendingRobot && !sessionId) {
    return <div className="glass-card h-64 animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {step === "link" && !resumePendingRobot && (
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="gap-1.5" onClick={onExit}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
          </div>
          <GlassPanel className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-lg font-bold">Paste the livestream link</h2>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">YouTube or Twitch — we&apos;ll try to detect the event from it.</p>
            <Input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
            {!parseStreamUrl(streamUrl) && streamUrl.length > 0 && (
              <p className="text-xs text-amber-400">That doesn&apos;t look like a YouTube or Twitch link yet.</p>
            )}
            <Button size="lg" disabled={!parseStreamUrl(streamUrl) || detecting} onClick={handleDetect}>
              {detecting ? "Detecting…" : "Continue"}
            </Button>
          </GlassPanel>
        </>
      )}

      {step === "event" && (
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="gap-1.5" onClick={() => setStep("link")}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
          </div>
          <GlassPanel className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">Confirm the event</h2>
            {detectError && <p className="text-sm text-red-400">{detectError}</p>}
            {event && detectedConfident ? (
              <div className="glass-card flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-semibold">{event.name}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{event.code}</div>
                </div>
                <Badge variant="success">Detected</Badge>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                {event ? "We couldn't confidently detect the event — confirm or pick a different one:" : "Pick the event this stream is for:"}
              </p>
            )}
            <div>
              <Label htmlFor="live-event">Event</Label>
              <Select value={event?.code ?? ""} onValueChange={(code) => setEvent(eventsQuery.data?.find((e) => e.code === code) ?? null)}>
                <SelectTrigger id="live-event">
                  <SelectValue>{event?.name ?? "Pick an event"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(eventsQuery.data ?? []).map((e) => (
                    <SelectItem key={e.code} value={e.code}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="lg" disabled={!event} onClick={() => setStep("match")}>
              Continue
            </Button>
          </GlassPanel>
        </>
      )}

      {step === "match" && event && (
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="gap-1.5" onClick={() => setStep("event")}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Badge variant="glass">{event.name}</Badge>
          </div>
          <GlassPanel className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">Pick the match</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Stream delay means the live match may not be posted yet — pick manually. We&apos;ll highlight our best guess.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="live-match-type">Match type</Label>
                <Select value={matchType} onValueChange={(v) => setMatchType(v as MatchType)}>
                  <SelectTrigger id="live-match-type">
                    <SelectValue>{matchType}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Qualification">Qualification</SelectItem>
                    <SelectItem value="Playoff">Playoff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="live-match-number">Match number</Label>
                <Input
                  id="live-match-number"
                  type="number"
                  min={1}
                  value={matchNumber ?? ""}
                  onChange={(e) => setMatchNumber(e.target.value ? Number(e.target.value) : null)}
                  placeholder={suggestedMatchNumber ? String(suggestedMatchNumber) : "12"}
                />
              </div>
            </div>
            {suggestedMatchNumber !== null && matchNumber !== suggestedMatchNumber && (
              <Button variant="glass" size="sm" className="self-start" onClick={() => setMatchNumber(suggestedMatchNumber)}>
                Use suggested match: {matchType} {suggestedMatchNumber}
              </Button>
            )}
            {matchNumber !== null && !officialMatch && (
              <div className="glass-card flex flex-col gap-3 p-4">
                <p className="text-xs text-[var(--muted-foreground)]">
                  This match isn&apos;t posted yet — enter both alliances&apos; team numbers manually.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    placeholder="Red 1"
                    onChange={(e) => setManualRoster((r) => ({ red: [Number(e.target.value) || 0, r?.red[1] ?? 0], blue: r?.blue ?? [0, 0] }))}
                  />
                  <Input
                    placeholder="Red 2"
                    onChange={(e) => setManualRoster((r) => ({ red: [r?.red[0] ?? 0, Number(e.target.value) || 0], blue: r?.blue ?? [0, 0] }))}
                  />
                  <Input
                    placeholder="Blue 1"
                    onChange={(e) => setManualRoster((r) => ({ blue: [Number(e.target.value) || 0, r?.blue[1] ?? 0], red: r?.red ?? [0, 0] }))}
                  />
                  <Input
                    placeholder="Blue 2"
                    onChange={(e) => setManualRoster((r) => ({ blue: [r?.blue[0] ?? 0, Number(e.target.value) || 0], red: r?.red ?? [0, 0] }))}
                  />
                </div>
              </div>
            )}
            <Button size="lg" disabled={matchNumber === null || !roster} onClick={() => setStep("robot")}>
              Continue
            </Button>
          </GlassPanel>
        </>
      )}

      {step === "robot" && event && matchNumber !== null && roster && (
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="gap-1.5" onClick={() => setStep("match")}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Badge variant="glass">
              {event.name} &middot; {matchType} {matchNumber}
            </Badge>
          </div>
          <GlassPanel className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">Pick your robot</h2>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {joinOption.kind === "forced" ? (
              <>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Someone&apos;s already scouting the other robot on this alliance — you&apos;re assigned Team {joinOption.teamNumber} to
                  complete it.
                </p>
                <GlassPanel strong className="flex items-center justify-between p-4">
                  <span className="font-semibold">Team {joinOption.teamNumber}</span>
                  <Badge className={joinOption.alliance === "red" ? "bg-red-500/15 text-red-300" : "bg-blue-500/15 text-blue-300"}>
                    {joinOption.alliance}
                  </Badge>
                </GlassPanel>
                <Button
                  size="lg"
                  disabled={claiming}
                  onClick={() => {
                    setAlliance(joinOption.alliance);
                    setTeamNumber(joinOption.teamNumber);
                    void handleClaimAndStart();
                  }}
                >
                  {claiming ? "Starting…" : "Start scouting"}
                </Button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {(["red", "blue"] as AllianceColor[]).map((side) =>
                    roster[side].map((team) => {
                      const disabled = joinOption.kind === "choice" && joinOption.alliance !== side;
                      return (
                        <GlassPanel
                          key={`${side}-${team}`}
                          interactive={!disabled}
                          onClick={() => {
                            if (disabled) return;
                            setAlliance(side);
                            setTeamNumber(team);
                          }}
                          className={`flex flex-col items-center gap-1 p-4 ${disabled ? "opacity-40" : ""} ${
                            teamNumber === team && alliance === side ? "ring-2 ring-[var(--color-primary)]" : ""
                          }`}
                        >
                          <span className="font-semibold">Team {team}</span>
                          <Badge className={side === "red" ? "bg-red-500/15 text-red-300" : "bg-blue-500/15 text-blue-300"}>{side}</Badge>
                        </GlassPanel>
                      );
                    })
                  )}
                </div>
                <Button size="lg" disabled={!teamNumber || !alliance || claiming} onClick={() => handleClaimAndStart()}>
                  {claiming ? "Starting…" : "Start scouting"}
                </Button>
              </>
            )}
          </GlassPanel>
        </>
      )}

      {step === "session" &&
        (session ? (
          <LiveSessionScreen
            session={session}
            streamUrl={streamUrl}
            onExitToLanding={onExit}
            onCompleted={() => setStep("results")}
          />
        ) : (
          <div className="glass-card h-64 animate-pulse" />
        ))}

      {step === "results" &&
        (session ? <LiveResultsScreen session={session} onBackToPracticeScouting={onExit} /> : <div className="glass-card h-64 animate-pulse" />)}
    </div>
  );
}

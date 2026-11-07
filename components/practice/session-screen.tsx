"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronDown, ChevronUp, Play, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScoutForm, type ScoutFormHandle, type ScoutFormValues } from "@/components/scout/scout-form";
import { VideoPlayer } from "@/components/video/video-player";
import { clipProgress, windowStart } from "@/lib/library/video-window";
import { MOCK_VIDEO_DURATION_SEC } from "@/components/video/mock-video-player";
import type { VideoPlayerHandle } from "@/components/video/types";
import { BreakMenu } from "@/components/practice/break-menu";
import { ChipSummary } from "@/components/practice/chip-summary";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { getSeason } from "@/lib/seasons";
import { computeAllianceAccuracy } from "@/lib/accuracy/engine";
import { evaluatePracticeSessionFlags, type PendingSessionFlag } from "@/lib/practice-flags";
import { BIOBUZZ_FORM_SCHEMA, calculateScore, valuesToScoutEntryFields } from "@/lib/scout-form/schema";
import {
  deletePracticeSession,
  hasCompletedAttemptBefore,
  updatePracticeSession,
  type PracticeSession,
} from "@/lib/practice-sessions";
import { getEntriesForSession, saveEntry, type ScoreBreakdown } from "@/lib/scout-entries";
import type { LibraryMatch } from "@/lib/match-library";
import { LoadError } from "@/components/practice/load-error";
import { describeFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";

type PendingRobot = { teamNumber: number; values: ScoutFormValues; score: ScoreBreakdown };

export function SessionScreen({
  session,
  libraryMatch,
  usePlaceholder,
  onExitToMatchSelect,
  onPaused,
  onCompleted,
}: {
  session: PracticeSession;
  libraryMatch: LibraryMatch;
  usePlaceholder: boolean;
  /** Change Match, Cancel, and End Session all land here — none of them save anything. */
  onExitToMatchSelect: () => void;
  onPaused: () => void;
  onCompleted: () => void;
}) {
  const [robotIndex, setRobotIndex] = useState(session.completedRobots.length);
  const [readyOverlay, setReadyOverlay] = useState(true);
  const [videoEnded, setVideoEnded] = useState(false);
  const [videoCollapsed, setVideoCollapsed] = useState(false);
  const [breakMenuOpen, setBreakMenuOpen] = useState(false);
  const [pendingRobot, setPendingRobot] = useState<PendingRobot | null>(null);
  const [changeMatchConfirmOpen, setChangeMatchConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FirestoreFailure | null>(null);

  const scoutFormRef = useRef<ScoutFormHandle>(null);
  const videoRef = useRef<VideoPlayerHandle>(null);

  const season = getSeason(session.seasonId);
  const teamNumber = session.robots[robotIndex];
  const isLastRobot = robotIndex === session.robots.length - 1;

  const handleStart = () => {
    setReadyOverlay(false);
    videoRef.current?.play();
  };

  // How far through the clip playback is, or null when that can't be known (no end time and the player hasn't reported a
  // length) — the "Finished Early" flag skips itself on null (FIX3). Without a library video it's the 2:30 placeholder.
  const videoProgressNow = (): number | null =>
    clipProgress(videoRef.current?.getCurrentTime() ?? 0, libraryMatch.video, videoRef.current?.getDuration() ?? (libraryMatch.video ? null : MOCK_VIDEO_DURATION_SEC));

  const saveRobotEntry = async (robot: PendingRobot) => {
    await saveEntry(session.teamId, session.uid, {
      scoutName: session.scoutName,
      eventCode: session.eventCode!,
      matchType: libraryMatch.matchType,
      matchNumber: libraryMatch.matchNumber,
      teamNumber: robot.teamNumber,
      fields: valuesToScoutEntryFields(robot.values.fields),
      score: robot.score,
      comments: String(robot.values.fields.comments ?? ""),
      source: "practice",
      mode: session.mode,
      sessionId: session.id,
      libraryMatchId: session.libraryMatchId!,
    });
  };

  const handleNextOrFinish = async () => {
    const handle = scoutFormRef.current;
    if (!handle || !handle.validate()) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    const values = handle.getValues();
    const score = calculateScore(BIOBUZZ_FORM_SCHEMA, values.fields);
    const robot: PendingRobot = { teamNumber, values, score };

    if (!isLastRobot) {
      setPendingRobot(robot);
      setBreakMenuOpen(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveRobotEntry(robot);
      const entries = await getEntriesForSession(session.teamId, session.id);
      const [first, second] = entries;
      if (!first || !second) throw new Error("Couldn't find both robots' entries.");

      const alliance = session.alliance!;
      const officialAlliance = libraryMatch.alliances[alliance];
      const { accuracy, scoutedTotal } = computeAllianceAccuracy({
        robotScores: [first.score.total, second.score.total],
        penaltyPoints: officialAlliance.penaltyPoints,
        officialScore: officialAlliance.score,
      });
      const priorCompletedAttempt = await hasCompletedAttemptBefore(
        session.teamId,
        session.uid,
        session.libraryMatchId!,
        alliance
      );
      const flags: PendingSessionFlag[] = evaluatePracticeSessionFlags({
        entries: [first, second],
        mode: session.mode,
        videoProgressAtFinish: videoEnded ? 1 : videoProgressNow(),
        priorCompletedAttempt,
      });

      await updatePracticeSession(session.id, {
        status: "completed",
        completedRobots: session.robots,
        entryIds: entries.map((e) => e.id),
        accuracy,
        scoutedTotal,
        penaltyPoints: officialAlliance.penaltyPoints,
        officialScore: officialAlliance.score,
        flags: flags.map((f) => ({ ...f, dismissed: false })),
        finishedAt: new Date().toISOString(),
      });
      onCompleted();
    } catch (err) {
      setError(describeFirestoreError("Couldn't finish the session.", err));
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    if (!pendingRobot) return;
    setSaving(true);
    setError(null);
    try {
      await saveRobotEntry(pendingRobot);
      await updatePracticeSession(session.id, { completedRobots: [...session.completedRobots, pendingRobot.teamNumber] });
      setBreakMenuOpen(false);
      setPendingRobot(null);
      setRobotIndex((i) => i + 1);
      setReadyOverlay(true);
      setVideoEnded(false);
      videoRef.current?.seek(windowStart(libraryMatch.video));
    } catch (err) {
      setError(describeFirestoreError("Couldn't save that robot's entry.", err));
    } finally {
      setSaving(false);
    }
  };

  const handlePause = async () => {
    if (!pendingRobot) return;
    setSaving(true);
    setError(null);
    try {
      await saveRobotEntry(pendingRobot);
      await updatePracticeSession(session.id, {
        status: "paused",
        completedRobots: [...session.completedRobots, pendingRobot.teamNumber],
      });
      onPaused();
    } catch (err) {
      setError(describeFirestoreError("Couldn't pause the session.", err));
      setSaving(false);
    }
  };

  const handleEndOrCancel = async () => {
    await deletePracticeSession(session.id);
    onExitToMatchSelect();
  };

  const alliance = session.alliance;
  const allianceTextClass = alliance === "red" ? "text-red-300" : "text-blue-300";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChipSummary seasonName={season.name} mode={session.mode} difficulty={session.difficulty} />
          <Badge variant="glass" className="font-mono">
            {MATCH_TYPE_PREFIX[libraryMatch.matchType]}
            {libraryMatch.matchNumber}
          </Badge>
          <span className={cn("text-xs font-semibold uppercase tracking-wide", allianceTextClass)}>{alliance}</span>
          <Badge variant="outline" className="text-[10px]">
            Robot {robotIndex + 1} of {session.robots.length}
          </Badge>
          <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{session.id}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setChangeMatchConfirmOpen(true)}>
          Change Match
        </Button>
      </div>

      {session.mode === "competitive" && (
        <p className="text-xs text-[var(--muted-foreground)]">Competitive: video can&apos;t be paused.</p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className={cn("lg:w-[58%] lg:shrink-0", "sticky top-[calc(env(safe-area-inset-top)+5rem)] z-10 lg:static")}>
          <div className="flex items-center justify-between lg:hidden">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Video</span>
            <button
              type="button"
              onClick={() => setVideoCollapsed((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/8"
              aria-label={videoCollapsed ? "Expand video" : "Collapse video"}
            >
              {videoCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
          {!videoCollapsed && (
            <div className="relative">
              <VideoPlayer
                ref={videoRef}
                video={libraryMatch.video}
                usePlaceholder={usePlaceholder}
                lockPause={session.mode === "competitive"}
                onEnded={() => setVideoEnded(true)}
              />
              <AnimatePresence>
                {readyOverlay && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={springSnappy}
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 scrim-blur"
                  >
                    <p className="text-sm font-medium text-white">
                      {robotIndex === 0 ? "Ready to scout?" : `Ready for Team ${teamNumber}?`}
                    </p>
                    <Button size="lg" className="gap-2" onClick={handleStart}>
                      <Play className="h-4 w-4" /> Start
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {videoEnded && !readyOverlay && (
                <div className="mt-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Match ended &mdash; finish whenever you&apos;re ready.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <ScoutForm
            key={robotIndex}
            ref={scoutFormRef}
            mode="practice"
            layout="side-panel"
            hideMatchPicker
            showSubmitButton={false}
            lockedFields={["teamNumber"]}
            prefill={{ teamNumber, scoutName: session.scoutName }}
          />
          {validationError && <p className="mt-2 text-sm font-medium text-red-300">Fill in the form before continuing.</p>}
        </div>
      </div>

      {error && <LoadError failure={error} />}

      <div className="glass-strong sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mt-2 flex items-center justify-between gap-3 rounded-full px-5 py-3 shadow-2xl">
        <Button variant="ghost" className="gap-1.5 text-red-300" onClick={() => setCancelConfirmOpen(true)}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button size="lg" className="gap-2" onClick={handleNextOrFinish} disabled={saving}>
          <Send className="h-4 w-4" />
          {saving ? "Saving…" : isLastRobot ? "Finish Session" : `Next Robot (${robotIndex + 1}/${session.robots.length})`}
        </Button>
      </div>

      <BreakMenu
        open={breakMenuOpen}
        completedTeamNumber={teamNumber}
        nextTeamNumber={session.robots[robotIndex + 1] ?? 0}
        saving={saving}
        onContinue={handleContinue}
        onPause={handlePause}
        onEnd={handleEndOrCancel}
      />

      <Dialog open={changeMatchConfirmOpen} onOpenChange={setChangeMatchConfirmOpen}>
        <DialogContent>
          <DialogTitle>Change match?</DialogTitle>
          <DialogDescription>Progress on this match will be discarded.</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setChangeMatchConfirmOpen(false)}>
              Keep going
            </Button>
            <Button variant="danger" onClick={handleEndOrCancel}>
              Discard &amp; change match
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent>
          <DialogTitle>Cancel this session?</DialogTitle>
          <DialogDescription>Nothing will be saved. This can&apos;t be undone.</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelConfirmOpen(false)}>
              Keep going
            </Button>
            <Button variant="danger" onClick={handleEndOrCancel}>
              Cancel session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

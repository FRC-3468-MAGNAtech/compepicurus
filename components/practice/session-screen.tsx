"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Play, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScoutForm, type ScoutFormHandle, type ScoutFormValues } from "@/components/scout/scout-form";
import { VideoPlayer } from "@/components/video/video-player";
import { clipProgress, windowStart } from "@/lib/library/video-window";
import { MOCK_VIDEO_DURATION_SEC } from "@/components/video/mock-video-player";
import type { VideoPlayerHandle } from "@/components/video/types";
import { BreakMenu } from "@/components/practice/break-menu";
import { ScoutingWorkspace } from "@/components/practice/scouting-workspace";
import { ChipSummary } from "@/components/practice/chip-summary";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { getSeason } from "@/lib/seasons";
import { computeAllianceAccuracy } from "@/lib/accuracy/engine";
import { evaluatePracticeSessionFlags, type PendingSessionFlag } from "@/lib/practice-flags";
import { calculateScore, type ScoreResult } from "@/lib/forms/scoring";
import { useLockedForm } from "@/lib/forms/forms-context";
import {
  deletePracticeSession,
  hasCompletedAttemptBefore,
  updatePracticeSession,
  type PracticeSession,
} from "@/lib/practice-sessions";
import { entryPayloadFor, getEntriesForSession, saveEntry } from "@/lib/scout-entries";
import type { StickyNote } from "@/lib/forms/types";
import { joinNotes } from "@/lib/forms/values";
import { notesForSave } from "@/lib/sticky-notes";
import type { LibraryMatch } from "@/lib/match-library";
import { LoadError } from "@/components/practice/load-error";
import { describeFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";

type PendingRobot = { teamNumber: number; values: ScoutFormValues; score: ScoreResult; stickyNotes: StickyNote[] };

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
  // The comments drawer's text for the robot being scouted: it is the form's `comments` value (ScoutForm commentsMode="popout"), cleared for each robot.
  // P28: the drawer's sticky notes for the robot being scouted (its `comments` text is derived from them); cleared for each robot.
  const [notes, setNotes] = useState<StickyNote[]>([]);
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
  // The season's form, fixed for this session so both robots are scouted with the same version.
  const form = useLockedForm(session.seasonId);
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
      ...entryPayloadFor(form, robot.values.values, robot.score, { stickyNotes: robot.stickyNotes }),
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
    const score = calculateScore(form, values.values);
    const robot: PendingRobot = { teamNumber, values, score, stickyNotes: notesForSave(notes) };

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
      // A form with scoring off has nothing to compare to the official score: accuracy is "n/a" (null), never an error (P21).
      const { accuracy, scoutedTotal } = form.scoringEnabled
        ? computeAllianceAccuracy({
            robotScores: [first.score.total, second.score.total],
            penaltyPoints: officialAlliance.penaltyPoints,
            officialScore: officialAlliance.score,
          })
        : { accuracy: null, scoutedTotal: null };
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
      setNotes([]);
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
    <div className="flex flex-col gap-2">
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

      <ScoutingWorkspace
        video={
          <div className="relative h-full w-full">
            <VideoPlayer ref={videoRef} fill video={libraryMatch.video} usePlaceholder={usePlaceholder} lockPause={session.mode === "competitive"} onEnded={() => setVideoEnded(true)} />
            <AnimatePresence>
              {readyOverlay && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={springSnappy} className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/70 scrim-blur">
                  <p className="text-sm font-medium text-white">{robotIndex === 0 ? "Ready to scout?" : `Ready for Team ${teamNumber}?`}</p>
                  <Button size="lg" className="gap-2" onClick={handleStart}>
                    <Play className="h-4 w-4" /> Start
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
        videoNote={
          videoEnded && !readyOverlay ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Match ended: finish whenever you&apos;re ready.
            </span>
          ) : session.mode === "competitive" ? (
            "Competitive: video can't be paused."
          ) : null
        }
        form={
          <ScoutForm
            key={`${robotIndex}-${form.id}@${form.version}`}
            schema={form}
            ref={scoutFormRef}
            mode="practice"
            layout="side-panel"
            hideMatchPicker
            showSubmitButton={false}
            lockedFields={["teamNumber"]}
            prefill={{ teamNumber, scoutName: session.scoutName }}
            commentsMode="popout"
            comments={joinNotes(notes)}
            onCommentsChange={() => undefined}
          />
        }
        comments={{ notes, onChange: setNotes, label: `Robot ${robotIndex + 1}: #${teamNumber}` }}
        notice={
          <>
            {validationError && <p className="mt-2 text-sm font-medium text-red-300">Fill in the form before continuing.</p>}
            {error && <LoadError failure={error} />}
          </>
        }
        actions={
          <>
            <Button variant="ghost" className="gap-1.5 text-red-300" onClick={() => setCancelConfirmOpen(true)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button size="lg" className="gap-2" onClick={handleNextOrFinish} disabled={saving}>
              <Send className="h-4 w-4" />
              {saving ? "Saving…" : isLastRobot ? "Finish Session" : `Next Robot (${robotIndex + 1}/${session.robots.length})`}
            </Button>
          </>
        }
      />

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

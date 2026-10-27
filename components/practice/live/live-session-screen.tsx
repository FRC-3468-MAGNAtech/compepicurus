"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Send, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScoutForm, type ScoutFormHandle } from "@/components/scout/scout-form";
import { embedUrlFor, parseStreamUrl } from "@/lib/live/stream";
import { LIVE_CONFIG } from "@/lib/live/config";
import { liveMatchKey, removePresence, upsertPresence } from "@/lib/live-presence";
import { useAuth } from "@/lib/auth";
import { calculateScore, valuesToScoutEntryFields, BIOBUZZ_FORM_SCHEMA } from "@/lib/scout-form/schema";
import { deletePracticeSession, updatePracticeSession, type PracticeSession } from "@/lib/practice-sessions";
import { getEntriesForSession, saveEntry } from "@/lib/scout-entries";

/**
 * P7: the stream embed only ever shows the live broadcast — it doesn't
 * attempt to capture `streamStartSec`/`streamEndSec` (both always written
 * as `null`, same as the schema already allows for "not captured"). Doing
 * that reliably needs the platform's own JS player SDK wired up with
 * postMessage round-trips, which couldn't be verified end-to-end without a
 * real live stream to test against; see docs/ASSUMPTIONS.md (P7). A clear
 * "Open stream in a new tab" card still always works regardless.
 */
export function LiveSessionScreen({
  session,
  streamUrl,
  onExitToLanding,
  onCompleted,
}: {
  session: PracticeSession;
  streamUrl: string;
  onExitToLanding: () => void;
  onCompleted: () => void;
}) {
  const { user } = useAuth();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoutFormRef = useRef<ScoutFormHandle>(null);

  const stream = parseStreamUrl(streamUrl);
  const matchKey = session.eventCode && session.matchType && session.matchNumber !== null ? liveMatchKey(session.eventCode, session.matchType, session.matchNumber) : null;
  const teamNumber = session.robots[0];

  // Presence heartbeat — written immediately on mount, then every
  // PRESENCE_HEARTBEAT_INTERVAL_MS, removed on unmount (Cancel/Submit both
  // unmount this screen one way or another).
  useEffect(() => {
    if (!matchKey || !user || !session.alliance) return;
    const write = () =>
      void upsertPresence(matchKey, {
        uid: user.uid,
        teamId: session.teamId,
        name: session.scoutName,
        robot: teamNumber,
        alliance: session.alliance!,
        sessionId: session.id,
      });
    write();
    const interval = setInterval(write, LIVE_CONFIG.PRESENCE_HEARTBEAT_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      void removePresence(matchKey, user.uid);
    };
  }, [matchKey, user, session.alliance, session.teamId, session.scoutName, session.id, teamNumber]);

  const handleCancel = async () => {
    await deletePracticeSession(session.id);
    onExitToLanding();
  };

  const handleSubmit = async () => {
    const handle = scoutFormRef.current;
    if (!handle || !handle.validate()) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    setSubmitting(true);
    setError(null);
    try {
      const values = handle.getValues();
      const score = calculateScore(BIOBUZZ_FORM_SCHEMA, values.fields);
      await saveEntry(session.teamId, session.uid, {
        scoutName: session.scoutName,
        eventCode: session.eventCode!,
        matchType: session.matchType!,
        matchNumber: session.matchNumber!,
        teamNumber,
        fields: valuesToScoutEntryFields(values.fields),
        score,
        comments: String(values.fields.comments ?? ""),
        source: "live",
        mode: null,
        sessionId: session.id,
        libraryMatchId: session.libraryMatchId,
      });
      const entries = await getEntriesForSession(session.teamId, session.id);
      await updatePracticeSession(session.id, {
        status: "completed",
        completedRobots: [teamNumber],
        entryIds: entries.map((e) => e.id),
        finishedAt: new Date().toISOString(),
      });
      // Try to resolve scores immediately — the server-side poller/fallback
      // still cover it if the official score isn't posted yet.
      try {
        await fetch("/api/live/check-scores", { method: "POST" });
      } catch {
        // Best-effort — the cron/client-poll fallbacks still cover this.
      }
      onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit that entry.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="lg:w-[58%] lg:shrink-0">
          {stream && stream.platform === "youtube" ? (
            <iframe
              src={embedUrlFor(stream)}
              className="aspect-video w-full rounded-2xl"
              allow="autoplay; encrypted-media"
              allowFullScreen
            />
          ) : stream && stream.platform === "twitch" ? (
            <iframe
              src={embedUrlFor(stream, typeof window !== "undefined" ? window.location.hostname : undefined)}
              className="aspect-video w-full rounded-2xl"
              allowFullScreen
            />
          ) : (
            <GlassPanel className="flex aspect-video flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">Can&apos;t embed this stream.</p>
              <a href={streamUrl} target="_blank" rel="noreferrer">
                <Button variant="glass" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Open stream in a new tab
                </Button>
              </a>
            </GlassPanel>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <ScoutForm
            ref={scoutFormRef}
            mode="live"
            layout="side-panel"
            hideMatchPicker
            showSubmitButton={false}
            lockedFields={["teamNumber"]}
            prefill={{ teamNumber, scoutName: session.scoutName }}
          />
          {validationError && <p className="mt-2 text-sm font-medium text-red-300">Fill in the form before submitting.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="glass-strong sticky bottom-3 z-20 mt-2 flex items-center justify-between gap-3 rounded-full px-5 py-3 shadow-2xl">
        <Button variant="ghost" className="gap-1.5 text-red-300" onClick={() => setCancelConfirmOpen(true)}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button size="lg" className="gap-2" onClick={handleSubmit} disabled={submitting}>
          <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit Scouting"}
        </Button>
      </div>

      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent>
          <DialogTitle>Cancel this session?</DialogTitle>
          <DialogDescription>Nothing will be saved. This can&apos;t be undone.</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelConfirmOpen(false)}>
              Keep going
            </Button>
            <Button variant="danger" onClick={handleCancel}>
              Cancel session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

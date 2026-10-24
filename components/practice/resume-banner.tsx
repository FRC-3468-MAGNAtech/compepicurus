"use client";

import { useState } from "react";
import { PauseCircle, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { deletePracticeSession, type PracticeSession } from "@/lib/practice-sessions";

export function ResumeBanner({
  session,
  onResume,
  onDiscarded,
}: {
  session: PracticeSession;
  onResume: () => void;
  onDiscarded: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const handleDiscard = async () => {
    setDiscarding(true);
    try {
      await deletePracticeSession(session.id);
      onDiscarded();
    } finally {
      setDiscarding(false);
      setConfirmOpen(false);
    }
  };

  return (
    <GlassPanel
      strong
      className="flex flex-wrap items-center justify-between gap-3 border-amber-400/30"
      style={{ boxShadow: "0 0 0 1px rgba(245,158,11,0.2)" }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15">
          <PauseCircle className="h-5 w-5 text-amber-300" />
        </span>
        <div>
          <div className="text-sm font-semibold">Paused session</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {session.completedRobots.length} of {session.robots.length} robots done &middot; {session.id}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onResume}>
          Resume
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" /> Discard
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogTitle>Discard this paused session?</DialogTitle>
          <DialogDescription>
            Progress on {session.completedRobots.length} completed robot{session.completedRobots.length === 1 ? "" : "s"} will be
            lost. This can&apos;t be undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDiscard} disabled={discarding}>
              {discarding ? "Discarding…" : "Discard"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </GlassPanel>
  );
}

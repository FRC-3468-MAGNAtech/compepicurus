"use client";

import { useState } from "react";
import { PauseCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * Shown between robot 1 and robot 2. Deliberately non-dismissible except by
 * one of the three explicit choices — `onOpenChange` is a no-op, so the X
 * button/Escape/outside-click can't silently lose the scout's progress.
 */
export function BreakMenu({
  open,
  completedTeamNumber,
  nextTeamNumber,
  saving,
  onContinue,
  onPause,
  onEnd,
}: {
  open: boolean;
  completedTeamNumber: number;
  nextTeamNumber: number;
  saving: boolean;
  onContinue: () => void;
  onPause: () => void;
  onEnd: () => void;
}) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent>
        {confirmingEnd ? (
          <>
            <DialogTitle>End this session?</DialogTitle>
            <DialogDescription>
              Nothing will be saved, including Team {completedTeamNumber}&apos;s entry. This can&apos;t be undone.
            </DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmingEnd(false)}>
                Back
              </Button>
              <Button variant="danger" onClick={onEnd}>
                End Session
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogTitle>Team {completedTeamNumber} done</DialogTitle>
            <DialogDescription>Take a short break, then continue to Team {nextTeamNumber} when you&apos;re ready.</DialogDescription>
            <div className="mt-4 flex flex-col gap-2">
              <Button size="lg" className="gap-2" onClick={onContinue} disabled={saving}>
                <Play className="h-4 w-4" /> {saving ? "Saving…" : `Continue to Team ${nextTeamNumber}`}
              </Button>
              <Button size="lg" variant="glass" className="gap-2" onClick={onPause} disabled={saving}>
                <PauseCircle className="h-4 w-4" /> Pause Session
              </Button>
              <Button size="lg" variant="ghost" className="text-red-300" onClick={() => setConfirmingEnd(true)} disabled={saving}>
                End Session
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

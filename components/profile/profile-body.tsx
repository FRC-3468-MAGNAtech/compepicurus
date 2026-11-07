"use client";

import { useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ProfileActivity, ProfileActivitySkeleton, ProfileHeader } from "@/components/profile/profile-sections";
import type { ProfileDoc } from "@/lib/profile/model";
import type { EventTargetProgress, ProfileStats } from "@/lib/profile/stats";
import type { TeamMember } from "@/lib/team-members";

/**
 * A profile a viewer is allowed to see, as plain props (no data fetching): the header with its moderation
 * action, then the activity — or its skeleton while `stats` is null. The connected page (profile-view.tsx) and
 * the browser-test fixture both render this.
 */
export function ProfileBody({
  member,
  profile,
  isSelf,
  stats,
  nowMs,
  eventName,
  target,
  targetEventName,
  canModerate,
  onClear,
}: {
  member: TeamMember;
  profile: ProfileDoc | null;
  isSelf: boolean;
  /** null while the team's scouting data loads. */
  stats: ProfileStats | null;
  nowMs: number;
  eventName: (code: string) => string;
  target: EventTargetProgress | null;
  targetEventName: string | null;
  /** The viewer is an admin who may clear this member's bio and pronouns. */
  canModerate: boolean;
  /** Clears them (and writes the audit entry); rejects when it can't. */
  onClear?: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasText = !!(profile?.bio.trim() || profile?.pronouns.trim());

  const clear = async () => {
    if (!onClear) return;
    setBusy(true);
    setError(null);
    try {
      await onClear();
      setConfirming(false);
    } catch {
      setError("Couldn't clear it. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ProfileHeader
        member={member}
        profile={profile}
        isSelf={isSelf}
        stats={stats}
        nowMs={nowMs}
        actions={
          canModerate && hasText && onClear ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setConfirming(true)} data-testid="clear-profile-text">
              <Eraser className="h-3.5 w-3.5" /> Clear bio &amp; pronouns
            </Button>
          ) : null
        }
      />
      {stats ? <ProfileActivity stats={stats} eventName={eventName} target={target} targetEventName={targetEventName} /> : <ProfileActivitySkeleton />}

      <Dialog open={confirming} onOpenChange={(v) => !busy && setConfirming(v)}>
        <DialogContent className="w-[min(94vw,460px)]">
          <DialogTitle>Clear {member.name}&apos;s bio and pronouns?</DialogTitle>
          <DialogDescription>
            This removes the text for everyone and is recorded in the audit log. Admins can clear a profile but never write one; {member.name} can add new text whenever they like.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={clear} disabled={busy} data-testid="confirm-clear-profile-text">
              {busy ? "Clearing…" : "Clear"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

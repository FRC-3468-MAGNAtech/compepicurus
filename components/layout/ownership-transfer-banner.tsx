"use client";

import { useState } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { livePendingTransfer } from "@/lib/team-owner";
import { acceptOwnershipTransfer, declineOwnershipTransfer } from "@/lib/team-transfer-client";
import { cn } from "@/lib/utils";

/**
 * P20: the banner the **recipient** of an ownership transfer sees on every page of the app until they respond: who
 * offered it, when it expires, and Accept / Decline. It appears (and disappears) in realtime, because the pending
 * transfer is a field on the team doc everyone on the account already listens to.
 */
export function OwnershipTransferBanner({ className }: { className?: string }) {
  const { user, profile } = useAuth();
  const { team } = useTeamDoc(profile?.teamId ?? null);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = livePendingTransfer(team?.pendingTransfer, now);
  if (!user || !pending || pending.toUid !== user.uid) return null;

  const respond = async (kind: "accept" | "decline") => {
    setBusy(kind);
    setError(null);
    try {
      await (kind === "accept" ? acceptOwnershipTransfer() : declineOwnershipTransfer());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="alert"
      data-testid="ownership-banner"
      className={cn("flex flex-col gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center", className)}
    >
      <Crown className="hidden h-5 w-5 shrink-0 text-amber-300 sm:block" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {pending.fromName || "Your team's owner"} wants to make you the owner of this account.
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Expires {new Date(pending.expiresAtMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.{" "}
          <Link href="/team-settings" className="underline underline-offset-4">
            Details
          </Link>
        </p>
        {error && <p className="mt-1 text-xs font-medium text-red-300">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => respond("accept")} disabled={busy !== null}>
          {busy === "accept" ? "Accepting…" : "Accept"}
        </Button>
        <Button size="sm" variant="glass" onClick={() => respond("decline")} disabled={busy !== null}>
          {busy === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
    </div>
  );
}

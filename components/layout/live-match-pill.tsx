"use client";

import { useState } from "react";
import { Radio, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTeamActiveLiveScouts } from "@/lib/live-presence";

/** A dismissible top-of-app pill while exactly one of this team's scouts is live on some match and needs a partner — same signal as the Practice Scouting landing page's Presence panel, just visible from anywhere. Dismissing hides it only until the active match changes (per-session, not persisted). */
export function LiveMatchPill() {
  const { profile } = useAuth();
  const { scouts } = useTeamActiveLiveScouts(profile?.teamId ?? null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const byMatch = new Map<string, typeof scouts>();
  for (const s of scouts) {
    const list = byMatch.get(s.matchKey) ?? [];
    list.push(s);
    byMatch.set(s.matchKey, list);
  }
  const solo = [...byMatch.entries()].find(([key, list]) => list.length === 1 && key !== dismissedKey);
  if (!solo) return null;
  const [matchKey, list] = solo;
  const scout = list[0];

  // `fixed`, not in-flow: this appears whenever a Firestore subscription
  // resolves, i.e. *after* the page is already on screen — as an in-flow
  // element it shoved the whole page down when it arrived (FIX1-1). Sits
  // below the mobile topbar and clears the safe-area inset.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+5.25rem)] z-30 flex justify-center px-3 lg:top-[calc(env(safe-area-inset-top)+0.75rem)]">
      <div className="glass-strong pointer-events-auto flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium shadow-lg">
        <Radio className="h-3.5 w-3.5 shrink-0 text-sky-300" />
        <span className="min-w-0">
          {scout.name} is scouting {matchKey} live &mdash; Team {scout.robot} needs a partner.
        </span>
        <button type="button" onClick={() => setDismissedKey(matchKey)} aria-label="Dismiss" className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

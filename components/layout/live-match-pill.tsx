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

  return (
    <div className="glass-pill mb-3 flex items-center gap-2 self-start px-3.5 py-1.5 text-xs font-medium">
      <Radio className="h-3.5 w-3.5 text-sky-300" />
      <span>
        {scout.name} is scouting {matchKey} live &mdash; Team {scout.robot} needs a partner.
      </span>
      <button type="button" onClick={() => setDismissedKey(matchKey)} aria-label="Dismiss" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

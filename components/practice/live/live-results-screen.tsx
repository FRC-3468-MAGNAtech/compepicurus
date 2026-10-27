"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Bell, Clock } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getStatus, getPercentColor } from "@/lib/accuracy/engine";
import { useAuth } from "@/lib/auth";
import { useEntriesForMatch } from "@/lib/scout-entries";
import { LIVE_CONFIG } from "@/lib/live/config";
import { isLikelyUnsupportedIOSBrowser, requestAndRegisterPush } from "@/lib/notifications";
import { cardEntranceVariants } from "@/lib/motion";
import type { PracticeSession } from "@/lib/practice-sessions";

export function LiveResultsScreen({ session, onBackToPracticeScouting }: { session: PracticeSession; onBackToPracticeScouting: () => void }) {
  const { user } = useAuth();
  const { entries } = useEntriesForMatch(session.teamId, session.eventCode, session.matchType, session.matchNumber);
  const [pushState, setPushState] = useState<"idle" | "requesting" | "enabled" | "failed">("idle");

  const resolved = session.accuracy !== null;

  // Client-side fallback poll (see docs/ARCHITECTURE.md, P7) — only runs
  // while waiting, stops the instant this session resolves (the realtime
  // session listener upstream re-renders this component with a non-null
  // accuracy, which this effect's own dependency picks up to clear itself).
  useEffect(() => {
    if (resolved) return;
    const interval = setInterval(() => {
      fetch("/api/live/check-scores", { method: "POST" }).catch(() => {});
    }, LIVE_CONFIG.CLIENT_SCORE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [resolved]);

  const handleEnableNotifications = async () => {
    if (!user) return;
    setPushState("requesting");
    const result = await requestAndRegisterPush(user.uid);
    setPushState(result.ok ? "enabled" : "failed");
  };

  if (!resolved) {
    return (
      <div className="flex flex-col gap-4">
        <GlassPanel strong className="flex flex-col items-center gap-3 py-12 text-center">
          <Clock className="h-8 w-8 text-[var(--muted-foreground)]" />
          <h2 className="text-lg font-semibold">Waiting for official scores</h2>
          <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
            You&apos;ll get your accuracy as soon as {session.matchType} {session.matchNumber}&apos;s official score is posted. We&apos;ll
            notify you — no need to wait here.
          </p>
          {pushState !== "enabled" && (
            <div className="flex flex-col items-center gap-2">
              <Button variant="glass" className="gap-2" disabled={pushState === "requesting"} onClick={handleEnableNotifications}>
                <Bell className="h-4 w-4" /> {pushState === "requesting" ? "Requesting…" : "Enable notifications"}
              </Button>
              {pushState === "failed" && <p className="text-xs text-amber-400">Couldn&apos;t enable push on this device/browser.</p>}
              {isLikelyUnsupportedIOSBrowser() && (
                <p className="max-w-xs text-xs text-[var(--muted-foreground)]">
                  On iPhone, push only works once this site is added to your Home Screen (Share &rarr; Add to Home Screen).
                </p>
              )}
            </div>
          )}
          {pushState === "enabled" && <Badge variant="success">Notifications enabled</Badge>}
        </GlassPanel>
        <Button size="lg" variant="glass" className="gap-2 self-start" onClick={onBackToPracticeScouting}>
          Back to Practice Scouting <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const accuracy = session.accuracy!;
  const status = getStatus(accuracy);
  const percentColor = getPercentColor(accuracy);
  const myEntry = entries.find((e) => e.teamNumber === session.robots[0]);
  const partnerEntry = entries.find((e) => e.teamNumber !== session.robots[0]);
  const difference = (session.scoutedTotal ?? 0) - (session.officialScore ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <motion.div variants={cardEntranceVariants} initial="hidden" animate="show">
        <GlassPanel strong className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Accuracy</span>
          <span className={`text-6xl font-bold tabular-nums ${percentColor}`}>{Math.round(accuracy)}%</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.badgeClassName}`}>{status.label}</span>
        </GlassPanel>
      </motion.div>

      <GlassPanel className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Comparison</h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label={`Team ${session.robots[0]}`} value={myEntry?.score.total ?? 0} />
          <Stat label={partnerEntry ? `Team ${partnerEntry.teamNumber}` : "Partner"} value={partnerEntry?.score.total ?? 0} />
          <Stat label="+ Penalties" value={session.penaltyPoints ?? 0} />
          <Stat label="= Scouted total" value={session.scoutedTotal ?? 0} emphasize />
        </div>
        <div className="my-1 h-px bg-[var(--glass-border)]" />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label="Scouted total" value={session.scoutedTotal ?? 0} />
          <Stat label="Official score" value={session.officialScore ?? 0} />
          <Stat label="Difference" value={difference} signed />
        </div>
      </GlassPanel>

      <Button size="lg" variant="glass" className="gap-2 self-start" onClick={onBackToPracticeScouting}>
        Back to Practice Scouting <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Stat({ label, value, emphasize, signed }: { label: string; value: number; emphasize?: boolean; signed?: boolean }) {
  const display = signed && value > 0 ? `+${value}` : String(value);
  return (
    <div className="glass-card flex flex-col gap-1 p-3">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <span className={emphasize ? "text-lg font-bold text-gradient" : "text-lg font-semibold"}>{display}</span>
    </div>
  );
}

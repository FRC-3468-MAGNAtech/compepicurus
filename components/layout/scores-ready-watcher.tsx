"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useTeamLiveSessions } from "@/lib/practice-sessions";
import { LIVE_CONFIG } from "@/lib/live/config";
import { onForegroundLiveScorePush } from "@/lib/notifications";
import { springSnappy } from "@/lib/motion";

/**
 * Global (mounted once in the app shell): the client-side fallback poller
 * (while any of the signed-in scout's own live sessions are still waiting
 * on scores, calls /api/live/check-scores every
 * LIVE_CONFIG.CLIENT_SCORE_POLL_INTERVAL_MS) and the top-of-screen "Scores
 * are available" popup — both for a pending session resolving while this
 * component is watching it, and for a foreground push notification
 * arriving. "Look" routes to Practice Scouting, where the Recent Live
 * Matches list's own "View Results" button opens the actual results.
 */
export function ScoresReadyWatcher() {
  const { user, profile } = useAuth();
  const { sessions } = useTeamLiveSessions(profile?.teamId ?? null);
  const router = useRouter();
  const [popup, setPopup] = useState<{ title: string; body: string } | null>(null);
  const previouslyPendingIds = useRef<Set<string>>(new Set());

  const myPending = sessions.filter((s) => s.uid === user?.uid && s.status === "completed" && s.accuracy === null);

  useEffect(() => {
    if (!user) return;
    const mine = sessions.filter((s) => s.uid === user.uid && s.status === "completed");
    const nowResolved = mine.filter((s) => s.accuracy !== null && previouslyPendingIds.current.has(s.id));
    if (nowResolved.length > 0) {
      const s = nowResolved[0];
      setPopup({ title: "Scores are available", body: `Your live match (${s.matchType} ${s.matchNumber}) has been scored.` });
    }
    previouslyPendingIds.current = new Set(mine.filter((s) => s.accuracy === null).map((s) => s.id));
  }, [sessions, user]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    onForegroundLiveScorePush((data) => setPopup({ title: data.title, body: data.body })).then((u) => {
      unsubscribe = u;
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (myPending.length === 0) return;
    const interval = setInterval(() => {
      fetch("/api/live/check-scores", { method: "POST" }).catch(() => {});
    }, LIVE_CONFIG.CLIENT_SCORE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [myPending.length]);

  return (
    <AnimatePresence>
      {popup && (
        <motion.div
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          transition={springSnappy}
          className="glass-strong fixed left-1/2 top-3 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl"
        >
          <Bell className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{popup.title}</div>
            <div className="truncate text-xs text-[var(--muted-foreground)]">{popup.body}</div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setPopup(null);
              router.push("/practice-scouting");
            }}
          >
            Look
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

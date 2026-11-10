"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { springSnappy } from "@/lib/motion";
import { isNewPublish, TEAM_ASSIGN_KIND_INFO, type TeamAssignmentsDoc } from "@/lib/team-assignments/model";
import { useTeamAssignmentDocs } from "@/lib/team-assignments/store";

// P31: the in-app notification when a Pit Scouting or Team Strategy assignment is published (or republished) with teams for the person: a popup at the top of the screen,
// once per published version per browser. Nothing is announced that was published more than a day ago (a new device doesn't replay the whole history), and a version
// the person has no teams in is never announced. The "seen" marker is per browser (localStorage) and the screen works without it.

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const seenKey = (uid: string, docId: string) => `assignments-seen:${uid}:${docId}`;

function readSeen(uid: string, docId: string): string | null {
  try {
    return window.localStorage.getItem(seenKey(uid, docId));
  } catch {
    return null;
  }
}
function writeSeen(uid: string, docId: string, at: string) {
  try {
    window.localStorage.setItem(seenKey(uid, docId), at);
  } catch {
    /* private window: the popup may show again next visit */
  }
}

export type AssignmentNotice = { docId: string; generatedAt: string; kind: "pit" | "teamStrategy"; eventCode: string; count: number };

/** The first unseen, recent version in which this person has teams. Pure apart from the `seen` lookup it is given. */
export function pendingNotice(docs: readonly TeamAssignmentsDoc[], uid: string, now: number, seen: (docId: string) => string | null): AssignmentNotice | null {
  for (const d of docs) {
    const current = d.current;
    if (!current || !isNewPublish(current, seen(d.id), now, MAX_AGE_MS)) continue;
    const count = current.teams.filter((t) => t.scoutUids.includes(uid)).length;
    if (count > 0) return { docId: d.id, generatedAt: current.generatedAt, kind: d.kind, eventCode: d.eventCode, count };
  }
  return null;
}

export function TeamAssignmentsWatcher() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { docs, loaded } = useTeamAssignmentDocs(profile?.teamId ?? null);
  const [notice, setNotice] = useState<AssignmentNotice | null>(null);
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid || !loaded) return;
    const next = pendingNotice(docs, uid, Date.now(), (id) => readSeen(uid, id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the popup follows the live documents
    setNotice(next);
  }, [docs, loaded, uid]);

  const dismiss = () => {
    if (uid && notice) writeSeen(uid, notice.docId, notice.generatedAt);
    setNotice(null);
  };
  const info = notice ? TEAM_ASSIGN_KIND_INFO[notice.kind] : null;

  return (
    <AnimatePresence>
      {notice && info && (
        <motion.div initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -24 }} transition={springSnappy} className="glass-strong fixed left-1/2 top-3 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl" role="status" data-testid="assignments-notice">
          <Bell className="h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">New {info.noun} assignments</div>
            <div className="truncate text-xs text-[var(--muted-foreground)]">
              You have {notice.count} team{notice.count === 1 ? "" : "s"} at {notice.eventCode}.
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              dismiss();
              router.push(info.href);
            }}
          >
            Look
          </Button>
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

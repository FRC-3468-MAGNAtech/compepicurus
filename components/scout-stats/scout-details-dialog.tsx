"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Eye, EyeOff, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getPercentColor } from "@/lib/accuracy/engine";
import { dismissSessionFlag, hardResetScoutData, setSessionExcluded } from "@/lib/scout-stats/actions";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutCategory, ScoutCategoryDetail } from "@/lib/scout-stats/types";
import { PlatformBadge } from "./platform-badge";

const RECENT_SHOWN = 5;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ScoutDetailsDialog({
  open,
  onOpenChange,
  category,
  detail,
  sessionsById,
  canManage,
  teamId,
  actorUid,
  actorName,
  allSessionsForScout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: ScoutCategory;
  detail: ScoutCategoryDetail | null;
  sessionsById: Map<string, PracticeSession>;
  canManage: boolean;
  teamId: string;
  actorUid: string;
  actorName: string;
  /** Every raw session for this scout in this category — what Hard Reset deletes. */
  allSessionsForScout: PracticeSession[];
}) {
  const [showAll, setShowAll] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

  if (!detail) return null;

  const isPractice = category !== "real-event";
  const recentSessions = isPractice ? detail.recentPracticeSessions : [];
  const shownSessions = showAll ? recentSessions : recentSessions.slice(0, RECENT_SHOWN);
  const shownEntries = showAll ? detail.recentRealEntries : detail.recentRealEntries.slice(0, RECENT_SHOWN);
  const hasMoreSessions = recentSessions.length > RECENT_SHOWN;
  const hasMoreEntries = detail.recentRealEntries.length > RECENT_SHOWN;

  const handleDismissFlag = async (sessionId: string, flagType: string) => {
    const session = sessionsById.get(sessionId);
    if (!session) return;
    setBusySessionId(sessionId);
    try {
      await dismissSessionFlag(teamId, actorUid, actorName, session, flagType);
    } finally {
      setBusySessionId(null);
    }
  };

  const handleToggleExcluded = async (sessionId: string, excluded: boolean) => {
    const session = sessionsById.get(sessionId);
    if (!session) return;
    setBusySessionId(sessionId);
    try {
      await setSessionExcluded(teamId, actorUid, actorName, session, excluded);
    } finally {
      setBusySessionId(null);
    }
  };

  const handleHardReset = async () => {
    if (category === "real-event") return;
    setResetting(true);
    try {
      await hardResetScoutData(teamId, actorUid, actorName, detail.uid, detail.name, category, allSessionsForScout);
      setConfirmResetOpen(false);
      onOpenChange(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(95vw,640px)] max-h-[85vh] overflow-y-auto">
          <DialogTitle>{detail.name}</DialogTitle>
          <DialogDescription>
            {category === "trial" ? "Trial Mode" : category === "competitive" ? "Competitive Mode" : "Real Event"} scouting record.
          </DialogDescription>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Avg accuracy" value={detail.averageAccuracy === null ? "?" : `${Math.round(detail.averageAccuracy)}%`} accentClass={detail.averageAccuracy !== null ? getPercentColor(detail.averageAccuracy) : undefined} />
            <Stat label={isPractice ? "Sessions" : "Forms completed"} value={String(detail.sessionsOrForms)} />
            {isPractice && <Stat label="Total entries" value={String(detail.totalEntries ?? 0)} />}
            <Stat label="Last scouted" value={formatDate(detail.lastScoutedAt)} />
          </div>

          {isPractice ? (
            <div className="mt-5 flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Recent practice scores</h3>
              {shownSessions.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No sessions yet.</p>
              ) : (
                shownSessions.map((s) => (
                  <div key={s.sessionId} className={`glass-card flex flex-col gap-2 p-3 ${s.excluded ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="glass" className="font-mono">{s.matchLabel}</Badge>
                      <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{s.sessionId}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">{formatDate(s.date)}</span>
                      <PlatformBadge platform={s.platform} />
                      <span className={`ml-auto font-semibold tabular-nums ${s.excluded ? "line-through text-[var(--muted-foreground)]" : s.accuracy !== null ? getPercentColor(s.accuracy) : ""}`}>
                        {s.accuracy === null ? "?" : `${Math.round(s.accuracy)}%`}
                      </span>
                    </div>
                    {s.activeFlags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {s.activeFlags.map((f) => (
                          <span
                            key={f.type}
                            className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"
                            title={f.detail}
                          >
                            <AlertTriangle className="h-3 w-3" /> {f.title}
                            {canManage && (
                              <button
                                type="button"
                                disabled={busySessionId === s.sessionId}
                                onClick={() => handleDismissFlag(s.sessionId, f.type)}
                                className="ml-0.5 underline underline-offset-2 hover:text-amber-100 disabled:opacity-50"
                              >
                                Dismiss
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          disabled={busySessionId === s.sessionId}
                          onClick={() => handleToggleExcluded(s.sessionId, !s.excluded)}
                        >
                          {s.excluded ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          {s.excluded ? "Include" : "Exclude Score From Percentage Average"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
              {hasMoreSessions && !showAll && (
                <Button variant="glass" size="sm" onClick={() => setShowAll(true)}>
                  View All Sessions ({recentSessions.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Recent real entries</h3>
                <Link href="/analytics/match-scout" className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  Match Analytics <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              {shownEntries.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No real-event entries yet.</p>
              ) : (
                shownEntries.map((e) => (
                  <div key={e.entryId} className={`glass-card flex flex-col gap-2 p-3 ${e.excluded ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="glass" className="font-mono">{e.matchLabel}</Badge>
                      <span className={`ml-auto font-semibold tabular-nums ${e.excluded ? "line-through text-[var(--muted-foreground)]" : e.accuracy !== null ? getPercentColor(e.accuracy) : ""}`}>
                        {e.accuracy === null ? "?" : `${Math.round(e.accuracy)}%`}
                      </span>
                    </div>
                    {(e.activeAutoFlagTitles.length > 0 || e.manualFlagReasons.length > 0) && (
                      <div className="flex flex-wrap gap-1.5">
                        {[...e.activeAutoFlagTitles, ...e.manualFlagReasons].map((title, i) => (
                          <span key={i} className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                            <AlertTriangle className="h-3 w-3" /> {title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              {hasMoreEntries && !showAll && (
                <Button variant="glass" size="sm" onClick={() => setShowAll(true)}>
                  View All Entries ({detail.recentRealEntries.length})
                </Button>
              )}
              <p className="text-xs text-[var(--muted-foreground)]">
                Dismiss/Exclude for real entries happen in Match Analytics&apos; Config modal, not here.
              </p>
            </div>
          )}

          {canManage && isPractice && (
            <div className="mt-5 border-t border-[var(--glass-border)] pt-4">
              <Button variant="danger" size="sm" className="gap-2" onClick={() => setConfirmResetOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Hard Reset Scout Data
              </Button>
            </div>
          )}

          {detail.status && (
            <div className="mt-5 flex flex-col gap-1.5 border-t border-[var(--glass-border)] pt-4">
              <Badge className={detail.status.badgeClassName}>{detail.status.label}</Badge>
              <p className="text-sm text-[var(--muted-foreground)]">{detail.status.guidance}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <DialogContent>
          <DialogTitle>Hard reset {detail.name}&apos;s {category} data?</DialogTitle>
          <DialogDescription>
            This permanently deletes every completed {category} session (and its scout entries) for {detail.name}. This can&apos;t be
            undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={resetting} onClick={handleHardReset}>
              {resetting ? "Resetting…" : "Hard Reset"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, accentClass }: { label: string; value: string; accentClass?: string }) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <span className={`text-lg font-semibold ${accentClass ?? ""}`}>{value}</span>
    </div>
  );
}

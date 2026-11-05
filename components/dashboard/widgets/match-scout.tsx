"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarRange, ClipboardCheck, FlaskConical, PauseCircle, Target } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber, useNow } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPercentColor } from "@/lib/accuracy/engine";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { useDashboard } from "@/lib/dashboard/data";
import { nextAssignment } from "@/lib/dashboard/insights";
import { timeAgo } from "@/lib/dashboard/time";
import { computePendingLiveRobots } from "@/lib/live/pending";
import type { ScoutCategory } from "@/lib/scout-stats/types";
import { cn } from "@/lib/utils";

const SLOT_LABEL = { red1: "Red 1", red2: "Red 2", blue1: "Blue 1", blue2: "Blue 2" } as const;

/** My next unscouted assignment, with a button that opens the Match Scout Form with it already loaded. */
export function NextAssignmentWidget() {
  const d = useDashboard();
  const code = d.event?.code ?? null;
  const published = !!d.assignments?.current;
  const hasMine = !!d.assignments?.current?.slots.some((s) => s.scoutUid === d.uid);

  const slot = useMemo(
    () => (d.assignments?.current && d.uid && code ? nextAssignment(d.assignments.current.slots, d.uid, code, d.eventEntries) : null),
    [d.assignments, d.uid, code, d.eventEntries]
  );

  const loading = !d.assignmentsLoaded || !d.entriesLoaded;
  return (
    <Widget
      title="My next assignment"
      icon={CalendarRange}
      size="medium"
      status={loading ? "loading" : slot ? "ready" : "empty"}
      href="/assignments"
      linkLabel="All assignments"
      emptyText={!published ? "No scouting schedule is published for this event yet." : hasMine ? "You're all caught up — every assignment is scouted." : "You have no assignments at this event."}
    >
      {slot && (
        <>
          <KeyNumber
            label={`${MATCH_TYPE_PREFIX[slot.matchType]}${slot.matchNumber} · ${SLOT_LABEL[slot.slot]}`}
            value={<>Team {slot.teamNumber}</>}
            hint="Scout this robot next"
          />
          <Link href={`/scout?event=${encodeURIComponent(code ?? "")}&load=next`} className="self-start">
            <Button className="h-11 gap-2">
              <ClipboardCheck className="h-4 w-4" /> Scout now
            </Button>
          </Link>
        </>
      )}
    </Widget>
  );
}

const CATEGORIES: { id: ScoutCategory; label: string }[] = [
  { id: "trial", label: "Trial" },
  { id: "competitive", label: "Competitive" },
  { id: "real-event", label: "Real Event" },
];

/** My accuracy, status band, and rank in each scouting category — the same numbers My Scouting shows. */
export function MyAccuracyWidget() {
  const d = useDashboard();
  const stats = d.scoutStats;
  const loading = !stats;

  return (
    <Widget title="My accuracy" icon={Target} size="medium" status={loading ? "loading" : "ready"} href="/my-scouting" linkLabel="My Scouting">
      <div className="flex flex-col gap-2">
        {CATEGORIES.map(({ id, label }) => {
          const detail = d.uid ? stats?.[id].detailsByUid.get(d.uid) : undefined;
          const rank = d.uid ? (stats?.[id].rows.find((r) => r.uid === d.uid)?.rank ?? null) : null;
          const accuracy = detail?.averageAccuracy ?? null;
          return (
            <div key={id} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-2">
              <span className="w-24 shrink-0 text-sm font-medium">{label}</span>
              <span className={cn("w-14 shrink-0 text-lg font-semibold tabular-nums", accuracy !== null && getPercentColor(accuracy))}>{accuracy === null ? "?" : `${Math.round(accuracy)}%`}</span>
              {detail?.status ? <span className={cn("truncate rounded-full px-2 py-0.5 text-[10px] font-medium", detail.status.badgeClassName)}>{detail.status.label}</span> : <span className="text-[11px] text-[var(--muted-foreground)]">Not rated yet</span>}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{rank === null ? "Rank ?" : `Rank #${rank}`}</span>
            </div>
          );
        })}
      </div>
    </Widget>
  );
}

/** A paused practice session to resume, and live robots nobody covered that I could still scout. */
export function ResumeWidget() {
  const d = useDashboard();
  const paused = d.sessions.find((s) => s.uid === d.uid && s.status === "paused") ?? null;
  const pending = useMemo(() => (d.uid ? computePendingLiveRobots(d.sessions.filter((s) => s.kind === "live"), d.uid) : []), [d.sessions, d.uid]);
  const nothing = !paused && pending.length === 0;

  return (
    <Widget
      title="Resume"
      icon={PauseCircle}
      size="small"
      status={!d.sessionsLoaded ? "loading" : nothing ? "empty" : "ready"}
      href="/practice-scouting"
      linkLabel="Practice Scouting"
      emptyText="Nothing to resume."
    >
      {paused && (
        <div>
          <div className="text-sm font-semibold">Paused session</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {paused.completedRobots.length} of {paused.robots.length} robots done · <span className="font-mono">{paused.id}</span>
          </div>
        </div>
      )}
      {pending.length > 0 && (
        <div>
          <div className="text-sm font-semibold">
            {pending.length} pending live {pending.length === 1 ? "robot" : "robots"}
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">An alliance partner nobody has scouted yet.</div>
        </div>
      )}
      <Link href="/practice-scouting" className="mt-auto self-start">
        <Button size="sm" variant="glass">
          {paused ? "Resume" : "Scout them"}
        </Button>
      </Link>
    </Widget>
  );
}

/** How many entries I've submitted at this event, and when the last one went in. */
export function MySubmissionsWidget() {
  const d = useDashboard();
  const now = useNow(30_000);
  const mine = useMemo(() => d.eventEntries.filter((e) => e.uid === d.uid), [d.eventEntries, d.uid]);
  const last = mine.reduce<string | null>((latest, e) => (latest === null || e.submittedAt > latest ? e.submittedAt : latest), null);

  return (
    <Widget title="My entries here" icon={ClipboardCheck} size="small" status={!d.entriesLoaded ? "loading" : mine.length === 0 ? "empty" : "ready"} href="/analytics/match-scout" linkLabel="Match Scout Analytics" emptyText="You haven't submitted an entry at this event yet.">
      <KeyNumber label="Submitted" value={mine.length} hint={last ? `Last ${timeAgo(Date.parse(last), now)}` : undefined} />
    </Widget>
  );
}

/** My last three practice sessions, with a button to start another. */
export function RecentPracticeWidget() {
  const d = useDashboard();
  const stats = d.scoutStats;
  const recent = useMemo(() => {
    if (!stats || !d.uid) return [];
    const trial = stats.trial.detailsByUid.get(d.uid)?.recentPracticeSessions ?? [];
    const competitive = stats.competitive.detailsByUid.get(d.uid)?.recentPracticeSessions ?? [];
    return [...trial, ...competitive].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 3);
  }, [stats, d.uid]);

  return (
    <Widget title="Recent practice" icon={FlaskConical} size="medium" status={!stats ? "loading" : "ready"} href="/practice-scouting" linkLabel="Practice Scouting">
      {recent.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No practice sessions yet — a few rounds is the quickest way to improve your accuracy.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {recent.map((s) => (
            <div key={s.sessionId} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-sm">
              <span className="font-mono text-xs">{s.matchLabel}</span>
              <span className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">{s.sessionId}</span>
              {s.activeFlags.length > 0 && <Badge variant="warning" className="text-[10px]">{s.activeFlags.length} flag{s.activeFlags.length === 1 ? "" : "s"}</Badge>}
              <span className={cn("ml-auto font-semibold tabular-nums", s.excluded ? "text-[var(--muted-foreground)] line-through" : s.accuracy !== null && getPercentColor(s.accuracy))}>
                {s.accuracy === null ? "?" : `${Math.round(s.accuracy)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
      <Link href="/practice-scouting" className="mt-auto self-start">
        <Button size="sm" className="gap-2">
          <FlaskConical className="h-4 w-4" /> Start Practice Scouting
        </Button>
      </Link>
    </Widget>
  );
}

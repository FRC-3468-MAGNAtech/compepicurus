"use client";

import { useMemo } from "react";
import { HeartPulse, LifeBuoy, ShieldCheck, Users } from "lucide-react";
import { useCoverage } from "@/components/dashboard/widgets/lead-scout";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { getPercentColor } from "@/lib/accuracy/engine";
import { useDashboard, useOurTeamEvent } from "@/lib/dashboard/data";
import { averageAccuracy } from "@/lib/dashboard/insights";
import { formatRecord } from "@/lib/dashboard/schedule";
import { formatScheduled } from "@/lib/dashboard/time";
import type { EventLifecycleStatus } from "@/lib/ftc/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<EventLifecycleStatus, { label: string; variant: "success" | "glass" | "outline" }> = {
  "in-progress": { label: "In Progress", variant: "success" },
  upcoming: { label: "Upcoming", variant: "glass" },
  completed: { label: "Completed", variant: "outline" },
};

/** Event status, our official rank and record, and the next match — the coach's one-glance summary. */
export function EventOverviewWidget() {
  const t = useOurTeamEvent();
  const status = t.eventStatus ? STATUS_LABEL[t.eventStatus] : null;
  const next = t.nextMatch;

  return (
    <Widget
      title="Event overview"
      icon={ShieldCheck}
      size="medium"
      status={t.first.loading ? "loading" : !t.event ? "empty" : "ready"}
      href="/event"
      linkLabel="Active Events"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-base font-semibold">{t.event?.name}</span>
        {status && <Badge variant={status.variant}>{status.label}</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <KeyNumber label="Rank" value={t.ourRanking ? `#${t.ourRanking.rank}` : "-"} />
        <KeyNumber label="Record" value={formatRecord(t.record)} />
        <KeyNumber
          label="Next"
          value={next ? next.label : "-"}
          hint={next ? (next.startMs !== null ? `Scheduled ${formatScheduled(next.startMs, t.timeZone)}` : "Time TBD") : "No upcoming match"}
        />
      </div>
    </Widget>
  );
}

/** How well the event is being scouted: coverage and the mean alliance accuracy of the data. */
export function ScoutingHealthWidget() {
  const d = useDashboard();
  const coverage = useCoverage();
  const accuracy = useMemo(() => averageAccuracy(d.usedEntries), [d.usedEntries]);

  return (
    <Widget title="Scouting health" icon={HeartPulse} size="small" status={d.first.loading || !d.entriesLoaded ? "loading" : "ready"} href="/analytics/match-breakdown" linkLabel="Match Breakdown">
      <KeyNumber label="Coverage" value={coverage.percent === null ? "-" : `${coverage.percent}%`} hint={coverage.playedMatches > 0 ? `${coverage.fullyScouted}/${coverage.playedMatches} matches fully scouted` : "No matches played yet"} />
      <div className="text-xs text-[var(--muted-foreground)]">
        Avg accuracy{" "}
        <span className={cn("text-sm font-semibold tabular-nums", accuracy !== null && getPercentColor(accuracy))}>{accuracy === null ? "—" : `${Math.round(accuracy)}%`}</span>
      </div>
    </Widget>
  );
}

/** Scouts currently at Mentor Intervention — the coach's cue to step in. */
export function InterventionWidget() {
  const d = useDashboard();
  const rows = d.scoutStats?.["real-event"].rows;
  const mentor = useMemo(() => (rows ?? []).filter((r) => r.status?.id === "mentor-intervention"), [rows]);

  return (
    <Widget title="Mentor Intervention" icon={LifeBuoy} size="medium" status={!rows ? "loading" : "ready"} href="/scout-accuracy" linkLabel="Scout Accuracy">
      {mentor.length === 0 ? (
        <p className="text-sm text-emerald-300">No scouts are at Mentor Intervention.</p>
      ) : (
        <>
          <KeyNumber label={mentor.length === 1 ? "Scout needing a mentor" : "Scouts needing a mentor"} value={mentor.length} />
          <div className="flex flex-wrap gap-1.5">
            {mentor.map((r) => (
              <Badge key={r.uid} variant="danger" className="text-xs">
                {r.name}
                {r.accuracy !== null && <span className="font-normal opacity-80"> {Math.round(r.accuracy)}%</span>}
              </Badge>
            ))}
          </div>
        </>
      )}
    </Widget>
  );
}

/** How many team members are marked as attending the selected event. */
export function AttendanceWidget() {
  const d = useDashboard();
  return (
    <Widget title="Attendance" icon={Users} size="small" status={!d.attendanceLoaded ? "loading" : "ready"} href="/assignments" linkLabel="Assignments">
      <KeyNumber label="Attending" value={d.attendingUids.length} hint={d.attendingUids.length === 0 ? "No attendance recorded for this event yet" : `at ${d.event?.name ?? "this event"}`} />
    </Widget>
  );
}

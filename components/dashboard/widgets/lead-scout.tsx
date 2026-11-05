"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarCheck, FlaskConical, Flag, Gauge, ScanEye } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber, useNow } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { formatMatch } from "@/lib/analytics/game-schema";
import { useDashboard } from "@/lib/dashboard/data";
import { assignmentStatus, computeCoverage, countByStatus, flaggedEntries, practiceActivity } from "@/lib/dashboard/insights";

/** Percent of played matches with every robot scouted, and which robots are missing from the rest. */
export function useCoverage() {
  const d = useDashboard();
  return useMemo(() => computeCoverage(d.officialMatches, d.eventEntries), [d.officialMatches, d.eventEntries]);
}

const MISSING_SHOWN = 4;

export function CoverageWidget() {
  const d = useDashboard();
  const coverage = useCoverage();
  const code = d.event?.code ?? null;
  const status = d.first.loading || !d.entriesLoaded ? "loading" : coverage.playedMatches === 0 && d.first.error ? "error" : coverage.playedMatches === 0 ? "empty" : "ready";

  return (
    <Widget
      title="Scouting coverage"
      icon={ScanEye}
      size="medium"
      status={status}
      href="/analytics/match-breakdown"
      linkLabel="Match Breakdown"
      errorText="The FIRST match list couldn't be loaded, so coverage can't be worked out."
      emptyText="No matches have been played at this event yet."
    >
      <KeyNumber label="Matches with all robots scouted" value={`${coverage.percent ?? 0}%`} hint={`${coverage.fullyScouted} of ${coverage.playedMatches} played matches`} />
      {coverage.missing.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Missing robots</div>
          {coverage.missing.slice(0, MISSING_SHOWN).map((m) => (
            <Link
              key={m.key}
              href={`/analytics/match-breakdown?event=${encodeURIComponent(code ?? "")}&match=${m.label}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-white/10"
            >
              <span className="font-mono font-semibold">{m.label}</span>
              <span className="text-[var(--muted-foreground)]">missing {m.missingTeams.join(", ")}</span>
            </Link>
          ))}
          {coverage.missing.length > MISSING_SHOWN && <span className="px-2 text-xs text-[var(--muted-foreground)]">+{coverage.missing.length - MISSING_SHOWN} more matches</span>}
        </div>
      )}
    </Widget>
  );
}

/** Scouts by accuracy status band (Real Event), and who needs help right now. */
export function AccuracySummaryWidget() {
  const d = useDashboard();
  const rows = d.scoutStats?.["real-event"].rows;
  const summary = useMemo(() => (rows ? countByStatus(rows) : null), [rows]);
  const attention = useMemo(() => (rows ?? []).filter((r) => r.status?.id === "mentor-intervention" || r.status?.id === "student-intervention"), [rows]);

  return (
    <Widget title="Scout accuracy" icon={Gauge} size="medium" status={!summary ? "loading" : "ready"} href="/scout-accuracy" linkLabel="Scout Accuracy">
      {summary && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {summary.bands.map((b) => (
              <div key={b.id} className="rounded-xl border border-[var(--glass-border)] px-2.5 py-2 text-center">
                <div className="text-2xl font-semibold tabular-nums">{b.count}</div>
                <div className="text-[10px] leading-tight text-[var(--muted-foreground)]">{b.label}</div>
              </div>
            ))}
          </div>
          {summary.unrated > 0 && <div className="text-xs text-[var(--muted-foreground)]">{summary.unrated} not rated yet</div>}
          {attention.length > 0 ? (
            <div className="text-xs">
              <span className="font-medium text-amber-300">Needs attention: </span>
              {attention.map((r) => r.name).join(", ")}
            </div>
          ) : (
            <div className="text-xs text-emerald-300">No scouts need intervention right now.</div>
          )}
        </>
      )}
    </Widget>
  );
}

/** Real-event entries with an automatic flag nobody has dismissed yet. */
export function FlaggedEntriesWidget() {
  const d = useDashboard();
  const flagged = useMemo(() => flaggedEntries(d.eventEntries), [d.eventEntries]);
  const code = d.event?.code ?? null;

  return (
    <Widget
      title="Flagged entries"
      icon={Flag}
      size="small"
      status={!d.entriesLoaded ? "loading" : flagged.length === 0 ? "empty" : "ready"}
      href={code ? `/analytics/match-scout?events=${encodeURIComponent(code)}` : "/analytics/match-scout"}
      linkLabel="Review in Match Scout Analytics"
      emptyText="No flagged entries awaiting review."
    >
      <KeyNumber label="Awaiting review" value={flagged.length} />
      <div className="flex flex-col gap-0.5 text-xs text-[var(--muted-foreground)]">
        {flagged.slice(0, 3).map((e) => (
          <span key={e.id}>
            <span className="font-mono font-semibold text-[var(--foreground)]">{formatMatch(e)}</span> · Team {e.teamNumber} · {e.scoutName}
          </span>
        ))}
      </div>
    </Widget>
  );
}

/** Is the scouting schedule published, who's attending but unassigned, and how many people are attending. */
export function AssignmentsStatusWidget() {
  const d = useDashboard();
  const status = useMemo(() => assignmentStatus(d.assignments, d.attendingUids, d.members), [d.assignments, d.attendingUids, d.members]);
  const loading = !d.assignmentsLoaded || !d.attendanceLoaded || !d.membersLoaded;

  return (
    <Widget title="Assignments" icon={CalendarCheck} size="small" status={loading ? "loading" : "ready"} href="/assignments" linkLabel="Assignments">
      <div className="flex items-center gap-2">
        <Badge variant={status.published ? "success" : "warning"}>{status.published ? "Published" : "Not published"}</Badge>
        <span className="text-xs text-[var(--muted-foreground)]">{d.attendingUids.length} attending</span>
      </div>
      {status.published ? (
        status.unassigned.length === 0 ? (
          <p className="text-xs text-emerald-300">Everyone attending has a slot.</p>
        ) : (
          <p className="text-xs">
            <span className="font-medium text-amber-300">{status.unassigned.length} unassigned: </span>
            <span className="text-[var(--muted-foreground)]">{status.unassigned.slice(0, 4).join(", ")}{status.unassigned.length > 4 ? ` +${status.unassigned.length - 4}` : ""}</span>
          </p>
        )
      ) : (
        <p className="text-xs text-[var(--muted-foreground)]">Generate and publish a schedule so scouts know their matches.</p>
      )}
    </Widget>
  );
}

/** Practice sessions finished in the last seven days, and how many scouts did them. */
export function PracticeWeekWidget() {
  const d = useDashboard();
  const now = useNow(60_000);
  const activity = useMemo(() => practiceActivity(d.sessions, now), [d.sessions, now]);

  return (
    <Widget title="Practice this week" icon={FlaskConical} size="small" status={!d.sessionsLoaded ? "loading" : activity.sessions === 0 ? "empty" : "ready"} href="/scout-accuracy" linkLabel="Scout Accuracy" emptyText="No practice sessions finished in the last 7 days.">
      <KeyNumber label="Sessions" value={activity.sessions} hint={`${activity.scouts} ${activity.scouts === 1 ? "scout" : "scouts"} · last 7 days`} />
    </Widget>
  );
}

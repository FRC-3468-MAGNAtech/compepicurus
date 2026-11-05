"use client";

import { CalendarClock, Flag } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { AllianceChip, Countdown, ResultRow, TeamLink } from "@/components/dashboard/shared";
import { useOurTeamEvent } from "@/lib/dashboard/data";
import { recentOurResults, upcomingOurMatches } from "@/lib/dashboard/schedule";
import { formatScheduled } from "@/lib/dashboard/time";
import type { WidgetSize, WidgetStatus } from "@/lib/dashboard/types";

// Widgets built purely from our slice of the FIRST schedule (via
// `useOurTeamEvent()`), shared by several roles.

/** Loading / error / empty for a widget that reads our schedule. `hasData` = whether it has something to show. */
function useScheduleStatus(hasData: boolean): WidgetStatus {
  const t = useOurTeamEvent();
  if (t.first.loading) return "loading";
  if (t.ourMatches.length === 0 && t.first.error) return "error";
  return hasData ? "ready" : "empty";
}

export const scheduleErrorText = "The FIRST schedule couldn't be loaded. It will retry when you reopen the dashboard.";

/** The next match: big countdown (always "Scheduled"), alliance color, partner, and — for the Drive Team — opponents. */
export function NextMatchWidget({ title = "Next match", showOpponents = false, size = "medium" }: { title?: string; showOpponents?: boolean; size?: WidgetSize }) {
  const t = useOurTeamEvent();
  const next = t.nextMatch;
  const status = useScheduleStatus(next !== null);
  const code = t.event?.code ?? null;

  return (
    <Widget
      title={title}
      icon={CalendarClock}
      size={size}
      status={status}
      href="/analytics/match-breakdown"
      linkLabel="Match Breakdown"
      errorText={scheduleErrorText}
      emptyText={t.ourNumber === null ? "Our team number isn't set." : t.ourMatches.length === 0 ? "No matches scheduled for us yet." : "All of our scheduled matches have been played."}
    >
      {next && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-sm font-semibold">{next.label}</span>
            <AllianceChip color={next.alliance} />
          </div>
          <Countdown startMs={next.startMs} timeZone={t.timeZone} large={size !== "small"} />
          <div className="text-sm">
            <span className="text-[var(--muted-foreground)]">Partner </span>
            {next.partner !== null ? <TeamLink teamNumber={next.partner} eventCode={code} /> : <span className="text-[var(--muted-foreground)]">TBD</span>}
            {next.partner !== null && t.teamNames.get(next.partner) && <span className="ml-1.5 text-xs text-[var(--muted-foreground)]">{t.teamNames.get(next.partner)}</span>}
          </div>
          {showOpponents && (
            <div className="text-sm">
              <span className="text-[var(--muted-foreground)]">Opponents </span>
              {next.opponents.length === 0 ? (
                <span className="text-[var(--muted-foreground)]">TBD</span>
              ) : (
                next.opponents.map((o, i) => (
                  <span key={o}>
                    {i > 0 && <span className="text-[var(--muted-foreground)]"> · </span>}
                    <TeamLink teamNumber={o} eventCode={code} />
                  </span>
                ))
              )}
            </div>
          )}
        </>
      )}
    </Widget>
  );
}

/** Our upcoming matches with their scheduled times and partners. */
export function UpcomingMatchesWidget({ title = "Upcoming schedule", limit = 5, size = "medium" }: { title?: string; limit?: number; size?: WidgetSize }) {
  const t = useOurTeamEvent();
  const upcoming = upcomingOurMatches(t.ourMatches, limit);
  const status = useScheduleStatus(upcoming.length > 0);
  const code = t.event?.code ?? null;

  return (
    <Widget
      title={title}
      icon={CalendarClock}
      size={size}
      status={status}
      href="/analytics/match-breakdown"
      linkLabel="Match Breakdown"
      errorText={scheduleErrorText}
      emptyText={t.ourMatches.length === 0 ? "No matches scheduled for us yet." : "No more matches scheduled for us."}
    >
      <div className="flex flex-col gap-1.5">
        {upcoming.map((m) => (
          <div key={m.match.eventCode + m.label} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-sm">
            <span className="min-w-10 rounded-lg bg-white/10 px-2 py-0.5 text-center font-mono text-xs font-semibold">{m.label}</span>
            <span className="flex-1 truncate text-xs text-[var(--muted-foreground)]">{m.startMs !== null ? `Scheduled ${formatScheduled(m.startMs, t.timeZone)}` : "Time TBD"}</span>
            <AllianceChip color={m.alliance} className="hidden sm:inline-flex" />
            {m.partner !== null && <TeamLink teamNumber={m.partner} eventCode={code} className="text-xs" />}
          </div>
        ))}
      </div>
    </Widget>
  );
}

/** Our played matches so far: official score, and win / loss / tie. */
export function OurResultsWidget({ title = "Our results", limit = 6, size = "medium" }: { title?: string; limit?: number; size?: WidgetSize }) {
  const t = useOurTeamEvent();
  const results = recentOurResults(t.ourMatches, limit);
  const status = useScheduleStatus(results.length > 0);
  const wins = t.record?.wins ?? 0;

  return (
    <Widget
      title={title}
      icon={Flag}
      size={size}
      status={status}
      href="/analytics/match-breakdown"
      linkLabel="Match Breakdown"
      errorText={scheduleErrorText}
      emptyText="We haven't played a match at this event yet."
      headerRight={t.record ? <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{wins}W {t.record.losses}L {t.record.ties}T</span> : undefined}
    >
      <div className="flex flex-col gap-2">
        {results.map((m) => (
          <ResultRow key={m.match.eventCode + m.label} match={m} />
        ))}
      </div>
    </Widget>
  );
}

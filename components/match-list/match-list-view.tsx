"use client";

import { useEffect, useMemo, useState } from "react";
import { MatchListScreen } from "@/components/match-list/match-list-screen";
import { useActiveEvents } from "@/lib/active-event";
import { useEventMatches } from "@/lib/analytics/use-event-data";
import { useIsOurTeam } from "@/lib/field-teams-context";

/** The existing API cache cadence (lib/analytics/use-event-data.ts caches the schedule for 3 minutes): the page re-asks at that pace while it is open and visible. */
export const MATCH_LIST_REFRESH_MS = 3 * 60 * 1000;

/** The connected Match List: the active events (primary first), their FIRST API schedules and the account's FTC teams. */
export function MatchListView() {
  const { events, loaded } = useActiveEvents();
  const isOurTeam = useIsOurTeam();
  const requests = useMemo(() => events.map((e) => ({ code: e.code, season: e.season })), [events]);
  const { matches, loading, error, updatedAt, refreshing, refresh } = useEventMatches(requests);

  // Statuses (In Progress, Upcoming) follow the clock: re-read it every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // Keep the schedule fresh while the page is open (a live event's results arrive minute by minute).
  useEffect(() => {
    if (requests.length === 0) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, MATCH_LIST_REFRESH_MS);
    return () => clearInterval(poll);
    // `refresh` is recreated each render but only reads the (stable) request key; the interval needs to restart only when the events change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  return (
    <MatchListScreen
      events={events}
      eventsLoaded={loaded}
      matches={matches}
      loading={loading}
      error={error}
      updatedAt={updatedAt}
      refreshing={refreshing}
      onRefresh={refresh}
      isOurTeam={(n) => isOurTeam(n)}
      now={now}
    />
  );
}

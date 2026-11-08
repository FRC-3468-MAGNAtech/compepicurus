"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MatchListScreen } from "@/components/match-list/match-list-screen";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { FtcEvent } from "@/lib/ftc/types";

declare global {
  interface Window {
    __refreshes?: number;
  }
}

const ev = (code: string, name: string): FtcEvent => ({ code, season: 2025, name, dateStart: "2025-11-08", dateEnd: "2025-11-08", city: null, stateProv: null, country: null, venue: null, website: null, timezone: "America/Los_Angeles", status: "in-progress" });
const EVENTS = [ev("USWABON1", "Bonney Lake Qualifier"), ev("USWASEQ", "Sequim League Meet")];
const OURS = new Set([3468, 35792]);

// 2025-11-08, "now" = 11:00 in Los Angeles (UTC-8). Q1 is at 09:00 and each match runs 10 minutes after it.
const NOW = Date.UTC(2025, 10, 8, 19, 0, 0);
const time = (minutesAfterNine: number) => {
  const total = 9 * 60 + minutesAfterNine;
  return `2025-11-08T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
};

/** 40 qualification matches (Q1-Q12 played, Q13 on the field at 11:00, the rest upcoming), 2 practice matches, 3 playoff matches. Our team 3468 plays Q5, Q13 and Q30. */
function schedule(eventCode: string, offset: number): OfficialMatch[] {
  const out: OfficialMatch[] = [];
  const base = offset * 1000;
  const team = (n: number) => base + 100 + n;
  for (let n = 1; n <= 40; n++) {
    const played = n <= 12;
    const mineRed = eventCode === "USWABON1" && (n === 5 || n === 13 || n === 30);
    out.push({
      eventCode,
      matchType: "Qualification",
      matchNumber: n,
      played,
      startTime: time((n - 1) * 10 + 0),
      red: { teams: mineRed ? [3468, team(n)] : [team(n), team(n + 1)], score: played ? 80 + n : null, penaltyPoints: played ? 0 : null },
      blue: { teams: [team(n + 2), team(n + 3)], score: played ? 70 + n : null, penaltyPoints: played ? 0 : null },
    });
  }
  for (let n = 1; n <= 2; n++) {
    out.push({ eventCode, matchType: "Practice", matchNumber: n, played: true, startTime: time(-60 + n * 10), red: { teams: [team(1), team(2)], score: 40, penaltyPoints: 0 }, blue: { teams: [team(3), team(4)], score: 50, penaltyPoints: 0 } });
  }
  const playoff: [number, number][] = [
    [1, 1],
    [2, 1],
    [3, 2],
  ];
  for (const [n, series] of playoff) {
    out.push({ eventCode, matchType: "Playoff", matchNumber: n, series, played: false, startTime: time(600 + n * 10), red: { teams: [team(5), team(6)], score: null, penaltyPoints: null }, blue: { teams: [team(7), team(8)], score: null, penaltyPoints: null } });
  }
  return out;
}

function Fixture() {
  const q = useSearchParams();
  const eventCount = Number(q.get("events") ?? 2);
  const state = q.get("state") ?? "ready";
  const events = EVENTS.slice(0, eventCount);
  const all = useMemo(() => [...schedule("USWABON1", 0), ...schedule("USWASEQ", 1)], []);
  const [updatedAt, setUpdatedAt] = useState<number | null>(Date.UTC(2025, 10, 8, 18, 58, 0));
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    window.__refreshes = 0;
  }, []);

  return (
    <div className="p-4">
      <MatchListScreen
        events={events}
        eventsLoaded
        matches={state === "loading" ? [] : all}
        loading={state === "loading"}
        error={state === "error"}
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={() => {
          window.__refreshes = (window.__refreshes ?? 0) + 1;
          setRefreshing(true);
          setTimeout(() => {
            setUpdatedAt(Date.UTC(2025, 10, 8, 19, 1, 0));
            setRefreshing(false);
          }, 300);
        }}
        isOurTeam={(n) => OURS.has(n)}
        now={NOW}
      />
    </div>
  );
}

export function MatchListFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { getMatchesForEvent, getRankingsForEvent, getTeamsForEvent } from "@/lib/ftc/actions";
import { ftcMatchToOfficial, type OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { FtcRanking, MatchType } from "@/lib/ftc/types";

// FIRST API data Analytics pages join onto scouted teams (P10): team names
// and official qualification rankings. Both go through the existing server
// actions (which are auth-gated and cache server-side); these hooks add a
// tab-level cache so moving between Analytics subpages doesn't refetch, and
// they treat any failure as "no data" — scouting stats are the product, the
// names/ranks are decoration that must never block a page.

export type EventRequest = { code: string; season: number };

const requestKey = (r: EventRequest) => `${r.code}:${r.season}`;

const RANKING_TTL_MS = 3 * 60 * 1000;
const MATCHES_TTL_MS = 3 * 60 * 1000;

const namesCache = new Map<string, Map<number, string>>();
const rankingsCache = new Map<string, { data: FtcRanking[]; expires: number }>();
const matchesCache = new Map<string, { data: OfficialMatch[]; expires: number }>();
const inflight = new Set<string>();

/** A stable string for a request list so hooks re-run only when the *set* of events changes. */
function keyOf(requests: EventRequest[]): string {
  return [...new Set(requests.map(requestKey))].sort().join("|");
}

function parseKey(key: string): EventRequest[] {
  return key === "" ? [] : key.split("|").map((k) => {
    const [code, season] = k.split(":");
    return { code, season: Number(season) };
  });
}

/** Team number → short name, merged across the requested events. Fills in as each event's team list arrives. */
export function useTeamNames(requests: EventRequest[]): ReadonlyMap<number, string> {
  const key = keyOf(requests);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    for (const r of parseKey(key)) {
      const k = requestKey(r);
      if (namesCache.has(k) || inflight.has(k)) continue;
      inflight.add(k);
      getTeamsForEvent(r.code, r.season)
        .then((res) => {
          namesCache.set(k, new Map(res.ok ? res.data.map((t) => [t.teamNumber, t.nameShort]) : []));
        })
        .catch(() => namesCache.set(k, new Map()))
        .finally(() => {
          inflight.delete(k);
          setVersion((v) => v + 1);
        });
    }
  }, [key]);

  return useMemo(() => {
    const merged = new Map<number, string>();
    for (const r of parseKey(key)) {
      for (const [teamNumber, name] of namesCache.get(requestKey(r)) ?? []) merged.set(teamNumber, name);
    }
    return merged;
    // `version` is the cache's change signal — the cache itself isn't React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

const MATCH_TYPES: MatchType[] = ["Practice", "Qualification", "Playoff"];

/**
 * Every official match (Practice, Qualification, Playoff) of the requested
 * events from the FIRST API, as `OfficialMatch`es. `loading` is true until
 * each requested event has answered at least once. A failed or empty fetch is
 * cached as "no matches" so it isn't retried in a loop (the cache expires, so a
 * live event picks up new results on the next visit).
 */
export function useEventMatches(requests: EventRequest[]): { matches: OfficialMatch[]; loading: boolean } {
  const key = keyOf(requests);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    for (const r of parseKey(key)) {
      const k = requestKey(r);
      const cached = matchesCache.get(k);
      if ((cached && cached.expires > Date.now()) || inflight.has(`matches:${k}`)) continue;
      inflight.add(`matches:${k}`);
      Promise.all(MATCH_TYPES.map((type) => getMatchesForEvent(r.code, type, r.season)))
        .then((results) => {
          const data = results.flatMap((res) => (res.ok ? res.data.map((m) => ftcMatchToOfficial(r.code, m)) : []));
          matchesCache.set(k, { data, expires: Date.now() + MATCHES_TTL_MS });
        })
        .catch(() => matchesCache.set(k, { data: [], expires: Date.now() + MATCHES_TTL_MS }))
        .finally(() => {
          inflight.delete(`matches:${k}`);
          setVersion((v) => v + 1);
        });
    }
  }, [key]);

  return useMemo(() => {
    const parsed = parseKey(key);
    const matches: OfficialMatch[] = [];
    let loading = false;
    for (const r of parsed) {
      const cached = matchesCache.get(requestKey(r));
      if (cached) matches.push(...cached.data);
      else loading = true;
    }
    return { matches, loading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

/** Official rankings per event code. An event with no rankings yet (or a failed fetch) is simply absent/empty. */
export function useEventRankings(requests: EventRequest[]): ReadonlyMap<string, FtcRanking[]> {
  const key = keyOf(requests);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    for (const r of parseKey(key)) {
      const k = requestKey(r);
      const cached = rankingsCache.get(k);
      if ((cached && cached.expires > Date.now()) || inflight.has(`rank:${k}`)) continue;
      inflight.add(`rank:${k}`);
      getRankingsForEvent(r.code, r.season)
        .then((res) => rankingsCache.set(k, { data: res.ok ? res.data : [], expires: Date.now() + RANKING_TTL_MS }))
        .catch(() => rankingsCache.set(k, { data: [], expires: Date.now() + RANKING_TTL_MS }))
        .finally(() => {
          inflight.delete(`rank:${k}`);
          setVersion((v) => v + 1);
        });
    }
  }, [key]);

  return useMemo(() => {
    const byEvent = new Map<string, FtcRanking[]>();
    for (const r of parseKey(key)) {
      const cached = rankingsCache.get(requestKey(r));
      if (cached && cached.data.length > 0) byEvent.set(r.code, cached.data);
    }
    return byEvent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

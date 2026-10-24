"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { FiltersBar } from "@/components/scout-stats/filters-bar";
import { MyScoutingCard } from "@/components/scout-stats/my-scouting-card";
import { PlatformBadge } from "@/components/scout-stats/platform-badge";
import { useAuth } from "@/lib/auth";
import { getPercentColor } from "@/lib/accuracy/engine";
import { computeScoutStats } from "@/lib/scout-stats/engine";
import { useRealEventOptions, useScoutStatsSources } from "@/lib/scout-stats/use-scout-stats";
import type { RankingBasisId, RealEventCalculationScope, ScoutCategory } from "@/lib/scout-stats/types";
import type { RoleId } from "@/lib/roles";

const CATEGORIES: ScoutCategory[] = ["trial", "competitive", "real-event"];

export default function MyScoutingPage() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;

  const [roleFilter, setRoleFilter] = useState<RoleId[]>([]);
  const [eventFilter, setEventFilter] = useState<string[]>([]);
  const [rankingBasis, setRankingBasis] = useState<RankingBasisId>("preserve");
  const [realEventScope, setRealEventScope] = useState<RealEventCalculationScope>({ eventCode: null, variant: "plain" });

  const sources = useScoutStatsSources(teamId);
  const eventOptions = useRealEventOptions(sources.entries);

  // Derived (not effect-corrected — see the matching comment in
  // app/(app)/scout-accuracy/page.tsx) so turning a filter back on restores
  // the user's last ranking-basis choice instead of forgetting it.
  const roleActive = roleFilter.length > 0;
  const eventActive = eventFilter.length > 0;
  const effectiveRankingBasis: RankingBasisId =
    (rankingBasis === "role" && !roleActive) ||
    (rankingBasis === "event" && !eventActive) ||
    (rankingBasis === "both" && !(roleActive && eventActive))
      ? "preserve"
      : rankingBasis;

  const resultsByCategory = useMemo(() => {
    if (!sources.loaded) return null;
    const results: Record<ScoutCategory, ReturnType<typeof computeScoutStats>> = {} as never;
    for (const category of CATEGORIES) {
      results[category] = computeScoutStats({
        category,
        members: sources.members,
        sessions: sources.sessions,
        entries: sources.entries,
        libraryMatchesById: sources.libraryMatchesById,
        attendance: sources.attendance,
        roleFilter,
        eventFilter,
        rankingBasis: effectiveRankingBasis,
        realEventScope,
      });
    }
    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sources.loaded,
    sources.members,
    sources.sessions,
    sources.entries,
    sources.libraryMatchesById,
    sources.attendance,
    roleFilter,
    eventFilter,
    effectiveRankingBasis,
    realEventScope.eventCode,
    realEventScope.variant,
  ]);

  const recentSessions = useMemo(() => {
    if (!resultsByCategory || !user) return [];
    const trial = resultsByCategory.trial.detailsByUid.get(user.uid)?.recentPracticeSessions ?? [];
    const competitive = resultsByCategory.competitive.detailsByUid.get(user.uid)?.recentPracticeSessions ?? [];
    return [...trial, ...competitive].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8);
  }, [resultsByCategory, user]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Scouting</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Your own accuracy, activity, and rank across every category.</p>
        </div>
        <Link href="/practice-scouting">
          <Button className="gap-2">
            <FlaskConical className="h-4 w-4" /> Start Practice Scouting
          </Button>
        </Link>
      </div>

      {!resultsByCategory || !user ? (
        <div className="glass-card h-64 animate-pulse" />
      ) : (
        <>
          <FiltersBar
            category="real-event"
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            eventOptions={eventOptions}
            eventFilter={eventFilter}
            onEventFilterChange={setEventFilter}
            rankingBasis={effectiveRankingBasis}
            onRankingBasisChange={setRankingBasis}
            realEventScope={realEventScope}
            onRealEventScopeChange={setRealEventScope}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {CATEGORIES.map((category, i) => {
              const detail = resultsByCategory[category].detailsByUid.get(user.uid);
              if (!detail) return null;
              const rank = resultsByCategory[category].rows.find((r) => r.uid === user.uid)?.rank ?? null;
              return <MyScoutingCard key={category} category={category} detail={detail} rank={rank} index={i} />;
            })}
          </div>

          <GlassPanel className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Recent practice sessions</h2>
            {recentSessions.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No practice sessions yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {recentSessions.map((s) => (
                  <div key={s.sessionId} className={`glass-card flex flex-wrap items-center gap-2 p-3 ${s.excluded ? "opacity-60" : ""}`}>
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">{s.matchLabel}</span>
                    <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{s.sessionId}</span>
                    <PlatformBadge platform={s.platform} />
                    {s.activeFlags.map((f) => (
                      <span key={f.type} className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300" title={f.detail}>
                        <AlertTriangle className="h-3 w-3" /> {f.title}
                      </span>
                    ))}
                    <span className={`ml-auto font-semibold tabular-nums ${s.excluded ? "line-through text-[var(--muted-foreground)]" : s.accuracy !== null ? getPercentColor(s.accuracy) : ""}`}>
                      {s.accuracy === null ? "?" : `${Math.round(s.accuracy)}%`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </>
      )}
    </div>
  );
}

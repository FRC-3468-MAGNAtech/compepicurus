"use client";

import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { CategoryTabs } from "@/components/scout-stats/category-tabs";
import { SummaryStats } from "@/components/scout-stats/summary-stats";
import { FiltersBar } from "@/components/scout-stats/filters-bar";
import { LeaderboardTable } from "@/components/scout-stats/leaderboard-table";
import { ScoutDetailsDialog } from "@/components/scout-stats/scout-details-dialog";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import type { RoleId } from "@/lib/roles";
import { useRealEventOptions, useScoutStats } from "@/lib/scout-stats/use-scout-stats";
import { useActiveEvents } from "@/lib/active-event";
import { useFieldTeams } from "@/lib/field-teams-context";
import { orderPrimaryFirst } from "@/lib/active-events";
import type { RankingBasisId, RealEventCalculationScope, ScoutCategory } from "@/lib/scout-stats/types";

export default function ScoutAccuracyPage() {
  const { user, profile } = useAuth();
  const { can } = usePermissions();
  const teamId = profile?.teamId ?? null;

  const [category, setCategory] = useState<ScoutCategory>("trial");
  const [roleFilter, setRoleFilter] = useState<RoleId[]>([]);
  const [eventFilter, setEventFilter] = useState<string[]>([]);
  // P19: Team filter, next to Role and Event. A chosen team that gets removed simply stops matching anyone's chips (ignored here).
  const { fieldTeams } = useFieldTeams();
  const [teamFilterRaw, setTeamFilter] = useState<string[]>([]);
  const teamFilter = useMemo(() => teamFilterRaw.filter((id) => fieldTeams.some((t) => t.id === id)), [teamFilterRaw, fieldTeams]);
  const [rankingBasis, setRankingBasis] = useState<RankingBasisId>("preserve");
  const [realEventScope, setRealEventScope] = useState<RealEventCalculationScope>({ eventCode: null, variant: "plain" });
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  // "Role Leaderboard"/"Event Leaderboard"/"both" only make sense while
  // their matching filter is actually active — derived here (not corrected
  // via an effect) so turning a filter back on restores the user's last
  // choice instead of permanently forgetting it.
  const roleActive = roleFilter.length > 0;
  const eventActive = eventFilter.length > 0;
  const effectiveRankingBasis: RankingBasisId =
    (rankingBasis === "role" && !roleActive) ||
    (rankingBasis === "event" && !eventActive) ||
    (rankingBasis === "both" && !(roleActive && eventActive))
      ? "preserve"
      : rankingBasis;

  const { result, loaded, sources } = useScoutStats({
    teamId,
    category,
    roleFilter,
    eventFilter,
    teamFilter,
    rankingBasis: effectiveRankingBasis,
    realEventScope,
  });
  const { events: activeEvents, primaryCode } = useActiveEvents();
  const orderedActiveEvents = useMemo(() => orderPrimaryFirst({ events: activeEvents, primaryCode }), [activeEvents, primaryCode]);
  const eventOptions = useRealEventOptions(sources.entries, orderedActiveEvents);

  const sessionsById = useMemo(() => new Map(sources.sessions.map((s) => [s.id, s])), [sources.sessions]);

  const selectedDetail = selectedUid ? (result?.detailsByUid.get(selectedUid) ?? null) : null;
  const allSessionsForSelectedScout = useMemo(
    () =>
      selectedUid && category !== "real-event"
        ? sources.sessions.filter((s) => s.uid === selectedUid && s.kind === "solo" && s.mode === category)
        : [],
    [sources.sessions, selectedUid, category]
  );

  return (
    <div className="flex flex-col gap-6">
      <GlassPanel strong className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "rgba(var(--glow), 0.16)" }}>
          <Target className="h-5 w-5" style={{ color: "var(--color-primary)" }} />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Scout Accuracy</h1>
          <p className="text-sm text-[var(--muted-foreground)]">How consistent each scout&apos;s data has been.</p>
        </div>
      </GlassPanel>

      <CategoryTabs value={category} onChange={setCategory} />

      {!loaded || !result ? (
        <div className="glass-card h-64 animate-pulse" />
      ) : (
        <>
          <SummaryStats category={category} summary={result.summary} />

          <FiltersBar
            category={category}
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            eventOptions={eventOptions}
            eventFilter={eventFilter}
            onEventFilterChange={setEventFilter}
            fieldTeams={fieldTeams}
            teamFilter={teamFilter}
            onTeamFilterChange={setTeamFilter}
            rankingBasis={effectiveRankingBasis}
            onRankingBasisChange={setRankingBasis}
            realEventScope={realEventScope}
            onRealEventScopeChange={setRealEventScope}
          />

          <GlassPanel>
            <LeaderboardTable category={category} rows={result.rows} onViewDetails={setSelectedUid} showTeams />
          </GlassPanel>
        </>
      )}

      {teamId && user && (
        <ScoutDetailsDialog
          open={selectedUid !== null}
          onOpenChange={(open) => !open && setSelectedUid(null)}
          category={category}
          detail={selectedDetail}
          sessionsById={sessionsById}
          canManage={can("manageScoutData")}
          teamId={teamId}
          actorUid={user.uid}
          actorName={profile?.name ?? ""}
          allSessionsForScout={allSessionsForSelectedScout}
        />
      )}
    </div>
  );
}

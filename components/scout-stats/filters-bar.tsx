"use client";

import { Fragment } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES, type RoleId } from "@/lib/roles";
import type { RankingBasisId, RealEventCalculationScope, ScoutCategory } from "@/lib/scout-stats/types";
import { cn } from "@/lib/utils";

const RANKING_BASIS_LABELS: Record<RankingBasisId, string> = {
  preserve: "Preserve original ranks",
  role: "Role Leaderboard",
  event: "Event Leaderboard",
  both: "Role + Event Leaderboard",
};

function ChipToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-transparent text-[var(--color-primary-foreground)]"
          : "border-dashed border-[var(--glass-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      )}
      style={active ? { background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" } : undefined}
    >
      {children}
    </button>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FiltersBar({
  category,
  roleFilter,
  onRoleFilterChange,
  eventOptions,
  eventFilter,
  onEventFilterChange,
  rankingBasis,
  onRankingBasisChange,
  realEventScope,
  onRealEventScopeChange,
}: {
  category: ScoutCategory;
  roleFilter: RoleId[];
  onRoleFilterChange: (next: RoleId[]) => void;
  eventOptions: { eventCode: string; eventName: string }[];
  eventFilter: string[];
  onEventFilterChange: (next: string[]) => void;
  rankingBasis: RankingBasisId;
  onRankingBasisChange: (next: RankingBasisId) => void;
  realEventScope: RealEventCalculationScope;
  onRealEventScopeChange: (next: RealEventCalculationScope) => void;
}) {
  const roleActive = roleFilter.length > 0;
  const eventActive = eventFilter.length > 0;
  const availableBases: RankingBasisId[] = ["preserve"];
  if (roleActive) availableBases.push("role");
  if (eventActive) availableBases.push("event");
  if (roleActive && eventActive) availableBases.push("both");

  const calcValue = `${realEventScope.eventCode ?? "all"}:${realEventScope.variant}`;

  return (
    <GlassPanel className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Role filter</Label>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <ChipToggle key={r.id} active={roleFilter.includes(r.id)} onClick={() => onRoleFilterChange(toggle(roleFilter, r.id))}>
              {r.label}
            </ChipToggle>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Event filter</Label>
        {eventOptions.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            No real events with scouted data yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {eventOptions.map((e) => (
              <ChipToggle
                key={e.eventCode}
                active={eventFilter.includes(e.eventCode)}
                onClick={() => onEventFilterChange(toggle(eventFilter, e.eventCode))}
              >
                {e.eventName}
              </ChipToggle>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ranking-basis">Ranking basis</Label>
          <Select value={rankingBasis} onValueChange={(v) => onRankingBasisChange(v as RankingBasisId)}>
            <SelectTrigger id="ranking-basis">
              <SelectValue>{RANKING_BASIS_LABELS[rankingBasis]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableBases.map((basis) => (
                <SelectItem key={basis} value={basis}>
                  {RANKING_BASIS_LABELS[basis]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {category === "real-event" && (
          <div>
            <Label htmlFor="real-event-calc">Calculation</Label>
            <Select
              value={calcValue}
              onValueChange={(v) => {
                const [eventPart, variant] = v.split(":") as [string, "plain" | "trial" | "competitive"];
                onRealEventScopeChange({ eventCode: eventPart === "all" ? null : eventPart, variant });
              }}
            >
              <SelectTrigger id="real-event-calc">
                <SelectValue>
                  {realEventCalculationLabel(realEventScope, eventOptions)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all:plain">All Events</SelectItem>
                <SelectItem value="all:trial">All Events (Trial)</SelectItem>
                <SelectItem value="all:competitive">All Events (Competitive)</SelectItem>
                {eventOptions.map((e) => (
                  <Fragment key={e.eventCode}>
                    <SelectItem value={`${e.eventCode}:plain`}>{e.eventName}</SelectItem>
                    <SelectItem value={`${e.eventCode}:trial`}>{e.eventName} (Trial)</SelectItem>
                    <SelectItem value={`${e.eventCode}:competitive`}>{e.eventName} (Competitive)</SelectItem>
                  </Fragment>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

function realEventCalculationLabel(
  scope: RealEventCalculationScope,
  eventOptions: { eventCode: string; eventName: string }[]
): string {
  const base = scope.eventCode === null ? "All Events" : eventOptions.find((e) => e.eventCode === scope.eventCode)?.eventName ?? scope.eventCode;
  if (scope.variant === "plain") return base;
  return `${base} (${scope.variant === "trial" ? "Trial" : "Competitive"})`;
}

"use client";

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { teamStats } from "@/lib/mock-data";

export default function TeamBreakdownPage() {
  const [teamNumber, setTeamNumber] = useState(String(teamStats[0].teamNumber));
  const team = useMemo(
    () => teamStats.find((t) => String(t.teamNumber) === teamNumber) ?? teamStats[0],
    [teamNumber]
  );

  const bars = [
    { label: "Autonomous", value: team.avgAuto, max: 25 },
    { label: "Teleop", value: team.avgTeleop, max: 80 },
    { label: "Endgame", value: team.avgEndgame, max: 20 },
  ];

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{team.teamName}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Team {team.teamNumber} &middot; Rank #{team.rank}</p>
        </div>
        <Select value={teamNumber} onValueChange={setTeamNumber}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {teamStats.map((t) => (
              <SelectItem key={t.teamNumber} value={String(t.teamNumber)}>
                {t.teamNumber} &mdash; {t.teamName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-5">
        {bars.map((b) => (
          <div key={b.label} className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{b.label}</span>
              <span className="text-[var(--muted-foreground)]">{b.value.toFixed(1)}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${Math.min(100, (b.value / b.max) * 100)}%`,
                  background: "linear-gradient(90deg, var(--color-primary), var(--color-accent))",
                }}
              />
            </div>
          </div>
        ))}
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <GlassPanel className="text-center">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Win rate</div>
          <div className="mt-2 text-2xl font-semibold">{Math.round(team.winRate * 100)}%</div>
        </GlassPanel>
        <GlassPanel className="text-center">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Avg. total</div>
          <div className="mt-2 text-2xl font-semibold">{team.avgTotal.toFixed(1)}</div>
        </GlassPanel>
        <GlassPanel className="text-center">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Rank</div>
          <div className="mt-2 text-2xl font-semibold">#{team.rank}</div>
        </GlassPanel>
      </div>
    </div>
  );
}

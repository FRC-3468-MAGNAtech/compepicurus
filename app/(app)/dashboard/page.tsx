"use client";

import Link from "next/link";
import { BarChart3, ClipboardList, ListChecks, TrendingUp } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { dashboardStats, matches, scouts, teamStats } from "@/lib/mock-data";

export default function DashboardPage() {
  const topTeams = [...teamStats].sort((a, b) => a.rank - b.rank).slice(0, 5);
  const recentMatches = matches.slice(0, 4);
  const activeScouts = scouts.slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Here&apos;s what&apos;s happening at the event right now.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((s, i) => (
          <StatCard key={s.label} label={s.label} value={s.value} delta={s.delta} index={i} icon={[ClipboardList, ListChecks, BarChart3, TrendingUp][i]} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassPanel className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent matches</h2>
            <Link href="/analytics/match-breakdown">
              <Button variant="ghost" size="sm">View all</Button>
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {recentMatches.map((m) => (
              <div key={m.id} className="glass-card flex items-center justify-between gap-3 p-3.5">
                <div className="flex items-center gap-3">
                  <Badge variant="glass">Q{m.matchNumber}</Badge>
                  <div className="text-sm">
                    <span className="text-red-300">{m.redAlliance.join(", ")}</span>
                    <span className="mx-1.5 text-[var(--muted-foreground)]">vs</span>
                    <span className="text-blue-300">{m.blueAlliance.join(", ")}</span>
                  </div>
                </div>
                <div className="text-sm font-semibold">
                  {m.redScore}&ndash;{m.blueScore}
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Scouts on shift</h2>
            <Link href="/scout-accuracy">
              <Button variant="ghost" size="sm">Details</Button>
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {activeScouts.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <Avatar name={s.name} color={s.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate text-xs text-[var(--muted-foreground)]">{s.role}</div>
                </div>
                <Badge variant={s.accuracy > 93 ? "success" : "outline"}>{s.accuracy}%</Badge>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Top ranked teams</h2>
          <Link href="/analytics/rankings">
            <Button variant="ghost" size="sm">Full rankings</Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {topTeams.map((t) => (
            <div key={t.teamNumber} className="glass-card flex flex-col gap-1 p-4">
              <div className="flex items-center justify-between">
                <Badge variant="accent">#{t.rank}</Badge>
                <span className="text-xs text-[var(--muted-foreground)]">{t.teamNumber}</span>
              </div>
              <div className="mt-1 truncate text-sm font-semibold">{t.teamName}</div>
              <div className="text-xs text-[var(--muted-foreground)]">{t.avgTotal.toFixed(1)} avg pts</div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

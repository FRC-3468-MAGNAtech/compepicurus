"use client";

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { matches } from "@/lib/mock-data";

export default function MatchBreakdownPage() {
  const [matchId, setMatchId] = useState(matches[0].id);
  const match = useMemo(() => matches.find((m) => m.id === matchId) ?? matches[0], [matchId]);

  const redPct = Math.round((match.redScore / (match.redScore + match.blueScore)) * 100);

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Match breakdown</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Score split for a single qualification match.</p>
        </div>
        <Select value={matchId} onValueChange={setMatchId}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {matches.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                Qualification {m.matchNumber}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-6">
        <div className="flex items-center justify-between text-sm font-medium">
          <span className="text-red-300">Red &mdash; {match.redScore}</span>
          <span className="text-blue-300">{match.blueScore} &mdash; Blue</span>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-400 transition-[width] duration-700 ease-out"
            style={{ width: `${redPct}%` }}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="glass-card p-4">
            <Badge variant="danger" className="mb-3">Red alliance</Badge>
            <div className="flex flex-col gap-1.5 text-sm">
              {match.redAlliance.map((t) => (
                <div key={t} className="flex justify-between">
                  <span>Team {t}</span>
                  <span className="text-[var(--muted-foreground)]">scored</span>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-card p-4">
            <Badge variant="outline" className="mb-3 border-blue-400/30 bg-blue-500/15 text-blue-300">
              Blue alliance
            </Badge>
            <div className="flex flex-col gap-1.5 text-sm">
              {match.blueAlliance.map((t) => (
                <div key={t} className="flex justify-between">
                  <span>Team {t}</span>
                  <span className="text-[var(--muted-foreground)]">scored</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

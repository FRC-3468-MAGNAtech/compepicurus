"use client";

import { Radio, UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTeamActiveLiveScouts } from "@/lib/live-presence";
import { useTeamLiveSessions } from "@/lib/practice-sessions";
import type { ResumePendingRobot } from "@/components/practice/live/live-flow";

/**
 * Shown on the Practice Scouting landing page only while exactly one of
 * this team's scouts is actively on some live match — per the prompt, this
 * is specifically the "someone needs a partner" signal, not a general
 * "who's live right now" roster. Joining this way is always the "forced
 * onto the same alliance's other robot" case (see lib/live/join-rules.ts)
 * since by definition only one robot is covered when this panel shows at
 * all — so it reuses the exact same "claim a session for a known robot"
 * path as the Pending Robots list, just with its target derived from the
 * active scout's own session instead of a completed one.
 */
export function PresencePanel({ teamId, onJoin }: { teamId: string | null; onJoin: (target: ResumePendingRobot) => void }) {
  const { scouts } = useTeamActiveLiveScouts(teamId);
  const { sessions } = useTeamLiveSessions(teamId);

  const byMatch = new Map<string, typeof scouts>();
  for (const s of scouts) {
    const list = byMatch.get(s.matchKey) ?? [];
    list.push(s);
    byMatch.set(s.matchKey, list);
  }
  const soloMatches = [...byMatch.entries()].filter(([, list]) => list.length === 1);

  if (soloMatches.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {soloMatches.map(([matchKey, list]) => {
        const scout = list[0];
        const theirSession = sessions.find((s) => s.id === scout.sessionId);
        const otherTeam = theirSession?.allianceTeams?.find((t) => t !== scout.robot);
        return (
          <GlassPanel key={matchKey} strong className="flex flex-wrap items-center gap-3 border-sky-400/30">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15">
              <Radio className="h-5 w-5 text-sky-300" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{scout.name} is scouting live</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                Team {scout.robot} &middot;{" "}
                <span className={scout.alliance === "red" ? "text-red-300" : "text-blue-300"}>{scout.alliance}</span> &middot;{" "}
                {theirSession?.matchType} {theirSession?.matchNumber}
              </div>
            </div>
            {theirSession && otherTeam !== undefined && theirSession.eventCode && theirSession.matchType && theirSession.matchNumber !== null && theirSession.allianceTeams ? (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  onJoin({
                    eventCode: theirSession.eventCode!,
                    matchType: theirSession.matchType!,
                    matchNumber: theirSession.matchNumber!,
                    alliance: scout.alliance,
                    teamNumber: otherTeam,
                    allianceTeams: theirSession.allianceTeams!,
                    streamUrl: theirSession.streamUrl,
                  })
                }
              >
                <UserPlus className="h-3.5 w-3.5" /> Join
              </Button>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Loading…
              </Badge>
            )}
            <Badge variant="glass" className="text-[10px]">
              Needs a partner
            </Badge>
          </GlassPanel>
        );
      })}
    </div>
  );
}

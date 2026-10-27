"use client";

import { Clock } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useTeamLiveSessions } from "@/lib/practice-sessions";
import { computePendingLiveRobots } from "@/lib/live/pending";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { ResumePendingRobot } from "@/components/practice/live/live-flow";

/** "If nobody scouts the other robot on a scout's alliance, that scout may scout it later" — shown on the Practice Scouting landing page. */
export function PendingRobotsList({ onStart }: { onStart: (target: ResumePendingRobot) => void }) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { sessions } = useTeamLiveSessions(teamId);
  const pending = user ? computePendingLiveRobots(sessions, user.uid) : [];

  if (pending.length === 0) return null;

  return (
    <GlassPanel className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Clock className="h-4 w-4 text-[var(--muted-foreground)]" /> Pending robots
      </h2>
      <div className="flex flex-col gap-2">
        {pending.map((p) => (
          <div key={p.sessionId} className="glass-card flex flex-wrap items-center gap-3 p-3">
            <Badge variant="glass" className="font-mono">
              {MATCH_TYPE_PREFIX[p.matchType]}
              {p.matchNumber}
            </Badge>
            <span className="text-sm">
              Team {p.teamNumber} from {MATCH_TYPE_PREFIX[p.matchType]}
              {p.matchNumber}
            </span>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() =>
                onStart({
                  eventCode: p.eventCode,
                  matchType: p.matchType,
                  matchNumber: p.matchNumber,
                  alliance: p.alliance,
                  teamNumber: p.teamNumber,
                  allianceTeams: p.allianceTeams,
                  streamUrl: p.streamUrl,
                })
              }
            >
              Scout now
            </Button>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

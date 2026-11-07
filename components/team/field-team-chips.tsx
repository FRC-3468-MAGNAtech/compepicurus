"use client";

import { Badge } from "@/components/ui/badge";
import { assignedFieldTeams, isImplicitlyAllTeams } from "@/lib/field-teams";
import { useFieldTeams } from "@/lib/field-teams-context";
import { cn } from "@/lib/utils";

/**
 * P19: small chips for the FTC teams a member is assigned to ("35792"), used on member rows (Team
 * Management, People, Scout Accuracy). A member with nothing recorded counts as all teams and gets one
 * "All teams" chip. Renders nothing for an account with a single FTC team, where chips would be noise.
 */
export function FieldTeamChips({ ids, className }: { ids?: readonly string[] | null; className?: string }) {
  const { fieldTeams } = useFieldTeams();
  if (fieldTeams.length <= 1) return null;

  if (isImplicitlyAllTeams(ids, fieldTeams)) {
    return (
      <Badge variant="outline" className={cn("text-[10px]", className)} title="Not assigned to a specific FTC team, so counted on every team">
        All teams
      </Badge>
    );
  }
  return (
    <>
      {assignedFieldTeams(ids, fieldTeams).map((t) => (
        <Badge key={t.id} variant="outline" className={cn("text-[10px] tabular-nums", className)} title={t.name ? `FTC ${t.number} · ${t.name}` : `FTC ${t.number}`}>
          {t.number}
        </Badge>
      ))}
    </>
  );
}

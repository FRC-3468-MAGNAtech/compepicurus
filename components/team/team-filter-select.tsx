"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldTeamFullLabel } from "@/lib/field-teams";
import { useFieldTeams } from "@/lib/field-teams-context";
import { cn } from "@/lib/utils";

export const ALL_TEAMS = "all";

/**
 * P19: the "Team" filter (a single FTC team, or all). Renders nothing for an account with one FTC
 * team, where there is nothing to filter. `value` is `ALL_TEAMS` or a field team id; an id whose team
 * was removed reads as "All teams" (and `selectedTeamIds` ignores it), so a stale choice is harmless.
 */
export function TeamFilterSelect({ value, onChange, className, id }: { value: string; onChange: (next: string) => void; className?: string; id?: string }) {
  const { fieldTeams } = useFieldTeams();
  if (fieldTeams.length <= 1) return null;
  const selected = fieldTeams.find((t) => t.id === value);
  return (
    <Select value={selected ? value : ALL_TEAMS} onValueChange={onChange}>
      <SelectTrigger id={id} className={cn("sm:w-56", className)} aria-label="Filter by FTC team">
        <SelectValue>{selected ? fieldTeamFullLabel(selected) : "All teams"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_TEAMS}>All teams</SelectItem>
        {fieldTeams.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {fieldTeamFullLabel(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The filter value as the list of team ids `matchesTeamFilter` expects (empty = everyone). */
export function selectedTeamIds(value: string, fieldTeams: readonly { id: string }[]): string[] {
  return fieldTeams.some((t) => t.id === value) ? [value] : [];
}

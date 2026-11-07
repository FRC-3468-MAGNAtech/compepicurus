"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { FieldTeamChips } from "@/components/team/field-team-chips";
import { ALL_TEAMS, TeamFilterSelect, selectedTeamIds } from "@/components/team/team-filter-select";
import { matchesTeamFilter } from "@/lib/field-teams";
import { useFieldTeams } from "@/lib/field-teams-context";
import { ROLES, getRole, type RoleId } from "@/lib/roles";
import type { TeamMember } from "@/lib/team-members";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * A checkbox roster with select-all/none and a role-based quick select —
 * shared by Attendance (every member) and the Randomize modal's Scouts
 * picker (attending members only, defaulting to Match Scout role).
 */
export function MemberMultiSelect({
  members: allMembers,
  selected,
  onChange,
}: {
  members: TeamMember[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  // P19: optional filter by FTC team (hidden for a single-team account). The quick selects below act on
  // the members shown; anyone already selected but filtered out stays selected.
  const { fieldTeams } = useFieldTeams();
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const members = useMemo(
    () => allMembers.filter((m) => matchesTeamFilter(m.fieldTeamIds, selectedTeamIds(teamFilter, fieldTeams), fieldTeams)),
    [allMembers, teamFilter, fieldTeams]
  );
  const shownUids = members.map((m) => m.uid);
  const rolesPresent = ROLES.filter((r) => members.some((m) => m.primaryRole === r.id || m.secondaryRoles.includes(r.id)));

  const selectRole = (roleId: RoleId) => {
    const roleUids = members.filter((m) => m.primaryRole === roleId || m.secondaryRoles.includes(roleId)).map((m) => m.uid);
    const allSelected = roleUids.every((uid) => selected.includes(uid));
    onChange(allSelected ? selected.filter((uid) => !roleUids.includes(uid)) : [...new Set([...selected, ...roleUids])]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="glass" size="sm" onClick={() => onChange([...new Set([...selected, ...shownUids])])}>
          Select all
        </Button>
        <Button type="button" variant="glass" size="sm" onClick={() => onChange(selected.filter((uid) => !shownUids.includes(uid)))}>
          Deselect all
        </Button>
        <div className="mx-1 h-5 w-px bg-[var(--glass-border)]" />
        {rolesPresent.map((r) => (
          <Button key={r.id} type="button" variant="glass" size="sm" onClick={() => selectRole(r.id)}>
            {r.label}
          </Button>
        ))}
        {fieldTeams.length > 1 && (
          <div className="ml-auto">
            <TeamFilterSelect value={teamFilter} onChange={setTeamFilter} className="h-10" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => {
          const checked = selected.includes(m.uid);
          const role = getRole(m.primaryRole);
          return (
            <label key={m.uid} className="glass-card flex cursor-pointer items-center gap-2.5 p-2.5">
              <Checkbox checked={checked} onCheckedChange={() => onChange(toggle(selected, m.uid))} />
              <Avatar name={m.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.name}</div>
                <div className="truncate text-[10px] text-[var(--muted-foreground)]">{role.label}</div>
                <div className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
                  <FieldTeamChips ids={m.fieldTeamIds} />
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

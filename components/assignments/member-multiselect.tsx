"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
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
  members,
  selected,
  onChange,
}: {
  members: TeamMember[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const rolesPresent = ROLES.filter((r) => members.some((m) => m.primaryRole === r.id || m.secondaryRoles.includes(r.id)));

  const selectRole = (roleId: RoleId) => {
    const roleUids = members.filter((m) => m.primaryRole === roleId || m.secondaryRoles.includes(roleId)).map((m) => m.uid);
    const allSelected = roleUids.every((uid) => selected.includes(uid));
    onChange(allSelected ? selected.filter((uid) => !roleUids.includes(uid)) : [...new Set([...selected, ...roleUids])]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="glass" size="sm" onClick={() => onChange(members.map((m) => m.uid))}>
          Select all
        </Button>
        <Button type="button" variant="glass" size="sm" onClick={() => onChange([])}>
          Deselect all
        </Button>
        <div className="mx-1 h-5 w-px bg-[var(--glass-border)]" />
        {rolesPresent.map((r) => (
          <Button key={r.id} type="button" variant="glass" size="sm" onClick={() => selectRole(r.id)}>
            {r.label}
          </Button>
        ))}
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
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

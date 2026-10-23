"use client";

import { ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES, getRole, type RoleId } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import type { TeamMember } from "@/lib/team-members";

export function MemberRow({
  member,
  editable,
  lastAdminBlocked,
  onPrimaryRoleChange,
  onToggleSecondaryRole,
  onToggleAdmin,
}: {
  member: TeamMember;
  editable: boolean;
  /** True when toggling this member's admin off would leave the team with zero admins. */
  lastAdminBlocked: boolean;
  onPrimaryRoleChange?: (role: RoleId) => void;
  onToggleSecondaryRole?: (role: RoleId) => void;
  onToggleAdmin?: () => void;
}) {
  const primaryRole = getRole(member.primaryRole);

  return (
    <motion.div layout transition={spring} className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={member.name} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{member.name}</span>
            {member.isAdmin && (
              <Badge variant="glass" className="gap-1 text-[10px]">
                <ShieldCheck className="h-3 w-3" /> Admin
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-[var(--muted-foreground)]">{member.email}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {editable ? (
          <Select value={member.primaryRole} onValueChange={(v) => onPrimaryRoleChange?.(v as RoleId)}>
            <SelectTrigger className="h-8 w-[160px] px-3 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", primaryRole.className)}>{primaryRole.label}</span>
        )}

        <div className="flex flex-wrap gap-1">
          {ROLES.filter((r) => r.id !== member.primaryRole).map((r) => {
            const active = member.secondaryRoles.includes(r.id);
            if (!editable && !active) return null;
            return (
              <button
                key={r.id}
                type="button"
                disabled={!editable}
                onClick={() => onToggleSecondaryRole?.(r.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  active
                    ? "border-[var(--glass-border)] bg-white/10 text-[var(--foreground)]"
                    : "border-dashed border-[var(--glass-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  !editable && "cursor-default"
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {editable && (
          <div className="flex items-center gap-1.5" title={lastAdminBlocked ? "At least one admin is required" : undefined}>
            <Switch checked={member.isAdmin} onCheckedChange={onToggleAdmin} disabled={member.isAdmin && lastAdminBlocked} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

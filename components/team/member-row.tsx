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
  // Owner rows can't be edited by anyone through this UI — not even the
  // owner themself — matching the "nobody, including other admins" rule
  // from docs/ASSUMPTIONS.md (P1b); also enforced in firestore.rules.
  const locked = member.isOwner;
  const rowEditable = editable && !locked;

  return (
    <motion.div layout transition={spring} className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={member.name} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{member.name}</span>
            {member.isOwner && (
              <Badge variant="glass" className="gap-1 text-[10px]">
                <ShieldCheck className="h-3 w-3" /> Owner
              </Badge>
            )}
            {member.isAdmin && !member.isOwner && (
              <Badge variant="glass" className="gap-1 text-[10px]">
                <ShieldCheck className="h-3 w-3" /> Admin
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-[var(--muted-foreground)]">{member.email}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {rowEditable ? (
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
            if (!rowEditable && !active) return null;
            return (
              <button
                key={r.id}
                type="button"
                disabled={!rowEditable}
                onClick={() => onToggleSecondaryRole?.(r.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  active
                    ? "border-[var(--glass-border)] bg-white/10 text-[var(--foreground)]"
                    : "border-dashed border-[var(--glass-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  !rowEditable && "cursor-default"
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {rowEditable && (
          <div className="flex items-center gap-1.5" title={lastAdminBlocked ? "At least one admin is required" : undefined}>
            <Switch checked={member.isAdmin} onCheckedChange={onToggleAdmin} disabled={member.isAdmin && lastAdminBlocked} />
          </div>
        )}
        {locked && member.isAdmin && (
          <div className="flex items-center gap-1.5" title="Owner status can't be changed here">
            <Switch checked disabled />
          </div>
        )}
      </div>
    </motion.div>
  );
}

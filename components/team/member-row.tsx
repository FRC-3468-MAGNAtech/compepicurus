"use client";

import { KeyRound, Pencil, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldTeamChips } from "@/components/team/field-team-chips";
import { HoverTip } from "@/components/ui/hover-tip";
import { getRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import type { MemberEditState } from "@/lib/member-access";
import type { TeamMember } from "@/lib/team-members";

/**
 * One roster row. Roles are always shown the same way — the primary role as a
 * coloured pill, secondary roles as uncoloured pills — and editing happens in
 * the member editor dialog (components/team/member-editor-dialog.tsx), opened
 * from the Edit button. `editState` comes from lib/member-access.ts so the
 * button mirrors what firestore.rules will actually allow. A row the viewer
 * can't edit shows a disabled Edit button whose tooltip says why — the control
 * is never silently missing (FIX2).
 */
export function MemberRow({
  member,
  editState,
  highlight,
  onEdit,
  onPageAccess,
  selection,
}: {
  member: TeamMember;
  editState: MemberEditState;
  /** Pulses the theme glow once — set briefly after this member was saved. */
  highlight?: boolean;
  onEdit?: () => void;
  /** P26: opens the member's page-access editor (admins only; omitted for everyone else). */
  onPageAccess?: () => void;
  /** P19: bulk-assign selection. Omitted when there is only one FTC team; `disabled` for rows the viewer can't edit. */
  selection?: { checked: boolean; onChange: (checked: boolean) => void; disabled: boolean };
}) {
  const primaryRole = getRole(member.primaryRole);

  return (
    <motion.div
      layout="position"
      transition={spring}
      animate={
        highlight
          ? { boxShadow: ["0 0 0 0 rgba(var(--glow),0)", "0 0 36px 4px rgba(var(--glow),0.55)", "0 0 0 0 rgba(var(--glow),0)"] }
          : { boxShadow: "0 0 0 0 rgba(var(--glow),0)" }
      }
      className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-center gap-3">
        {selection && (
          <Checkbox
            checked={selection.checked}
            onCheckedChange={(v) => selection.onChange(v === true)}
            disabled={selection.disabled}
            aria-label={selection.disabled ? `Select ${member.name} (not available)` : `Select ${member.name}`}
            className="h-7 w-7"
          />
        )}
        <Avatar name={member.name} size="sm" avatar={member.avatar} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{member.name}</span>
            {member.isOwner && (
              <Badge variant="glass" className="shrink-0 gap-1 text-[10px]">
                <ShieldCheck className="h-3 w-3" /> Owner
              </Badge>
            )}
            {member.isAdmin && !member.isOwner && (
              <Badge variant="glass" className="shrink-0 gap-1 text-[10px]">
                <ShieldCheck className="h-3 w-3" /> Admin
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-[var(--muted-foreground)]">{member.email}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", primaryRole.className)}>{primaryRole.label}</span>
        {member.secondaryRoles.map((id) => (
          <Badge key={id} variant="glass" className="text-[10px]">
            {getRole(id).label}
          </Badge>
        ))}
        <FieldTeamChips ids={member.fieldTeamIds} />

        {onPageAccess && (
          <Button size="sm" variant="glass" className="gap-1.5" onClick={onPageAccess} aria-label={`Page access for ${member.name}`} data-testid={`page-access-${member.uid}`}>
            <KeyRound className="h-3.5 w-3.5" /> Page access
          </Button>
        )}

        {editState.canEdit ? (
          <Button size="sm" variant="glass" className="gap-1.5" onClick={onEdit} aria-label={`Edit ${member.name}`}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        ) : (
          <HoverTip content={editState.lockedReason ?? "You can't edit this member."} align="end">
            <Button size="sm" variant="glass" className="gap-1.5" disabled aria-label={`Edit ${member.name} (not available)`}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </HoverTip>
        )}
      </div>
    </motion.div>
  );
}

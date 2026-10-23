"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { MemberRow } from "@/components/team/member-row";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { usePermissions } from "@/lib/permissions";
import { setMemberAdmin, setMemberPrimaryRole, setMemberSecondaryRoles, useTeamMembers } from "@/lib/team-members";
import type { RoleId } from "@/lib/roles";

export default function TeamManagementPage() {
  const { profile } = useAuth();
  const { team, loaded: teamLoaded } = useTeamDoc();
  const { isAdmin } = usePermissions();
  const { members, loaded: membersLoaded } = useTeamMembers(profile?.teamId ?? null);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const adminCount = members.filter((m) => m.isAdmin).length;

  const handleCopyJoinCode = async () => {
    if (!team?.joinCode) return;
    try {
      await navigator.clipboard.writeText(team.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access can fail silently (permissions, insecure context); the code is still shown on screen.
    }
  };

  const handleToggleAdmin = (uid: string, current: boolean) => {
    void setMemberAdmin(uid, !current);
  };

  const handleToggleSecondaryRole = (uid: string, roles: RoleId[], role: RoleId) => {
    const next = roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role];
    void setMemberSecondaryRoles(uid, next);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team Management</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Roles, admin access, and the team join code.</p>
        </div>
      </div>

      <GlassPanel className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Team</div>
          <div className="text-xl font-semibold">{teamLoaded ? `FTC ${team?.number ?? "—"}` : "Loading…"}</div>
        </div>
        {isAdmin && team && (
          <div className="flex items-center gap-2">
            {showJoinCode ? (
              <>
                <span className="glass-card rounded-xl px-4 py-2 font-mono text-lg tracking-[0.25em]">{team.joinCode}</span>
                <Button variant="glass" size="sm" className="gap-2" onClick={handleCopyJoinCode}>
                  <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy"}
                </Button>
              </>
            ) : null}
            <Button variant="glass" size="sm" className="gap-2" onClick={() => setShowJoinCode((v) => !v)}>
              {showJoinCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showJoinCode ? "Hide join code" : "Show join code"}
            </Button>
          </div>
        )}
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Members {membersLoaded && `(${members.length})`}
        </h2>
        <div className="flex flex-col gap-2">
          {!membersLoaded ? (
            <div className="glass-card h-16 animate-pulse" />
          ) : members.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No members yet.</p>
          ) : (
            members.map((m) => (
              <MemberRow
                key={m.uid}
                member={m}
                editable={isAdmin}
                lastAdminBlocked={m.isAdmin && adminCount <= 1}
                onPrimaryRoleChange={(role) => void setMemberPrimaryRole(m.uid, role)}
                onToggleSecondaryRole={(role) => handleToggleSecondaryRole(m.uid, m.secondaryRoles, role)}
                onToggleAdmin={() => {
                  if (m.isAdmin && adminCount <= 1) return;
                  handleToggleAdmin(m.uid, m.isAdmin);
                }}
              />
            ))
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { MemberRow } from "@/components/team/member-row";
import { MemberEditorDialog } from "@/components/team/member-editor-dialog";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { usePermissions } from "@/lib/permissions";
import { updateMemberAccess, useTeamMembers, type TeamMember } from "@/lib/team-members";
import { getMemberEditState, type MemberAccess } from "@/lib/member-access";

export default function TeamManagementPage() {
  const { user, profile } = useAuth();
  const { team, loaded: teamLoaded } = useTeamDoc(profile?.teamId ?? null);
  const { isAdmin } = usePermissions();
  const { members, loaded: membersLoaded } = useTeamMembers(profile?.teamId ?? null);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Bumped on every open so the editor remounts with a draft taken from the member's current values.
  const [editorKey, setEditorKey] = useState(0);
  const [savedUid, setSavedUid] = useState<string | null>(null);

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

  const actor = { uid: user?.uid ?? "", isAdmin };
  // The roster is realtime: guard and block-reasons use the member's *current* row, while the editor's draft keeps the values it opened with.
  const liveEditing = editing ? (members.find((m) => m.uid === editing.uid) ?? editing) : null;
  const editState = (m: TeamMember) => getMemberEditState(actor, m, adminCount);

  const openEditor = (m: TeamMember) => {
    setEditing(m);
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
  };

  const handleSave = async (member: TeamMember, changes: Partial<MemberAccess>) => {
    if (!user || !profile) return;
    // Re-checked here, not just by the button: the roster is realtime, so the
    // member (or the admin count) may have changed since the editor opened.
    if (!getMemberEditState(actor, member, adminCount).canEdit) throw new Error("not allowed");

    // One atomic batch: the role change and its audit entry land together or not at all.
    await updateMemberAccess({ teamId: profile.teamId, uid: user.uid, name: profile.name }, member, changes);
    setSavedUid(member.uid);
    setTimeout(() => setSavedUid((current) => (current === member.uid ? null : current)), 1500);
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
                editState={isAdmin ? editState(m) : undefined}
                highlight={savedUid === m.uid}
                onEdit={() => openEditor(m)}
              />
            ))
          )}
        </div>
      </GlassPanel>

      {editing && liveEditing && (
        <MemberEditorDialog
          key={editorKey}
          member={editing}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          adminToggleBlock={editState(liveEditing).adminToggleBlock}
          onSave={(changes) => handleSave(liveEditing, changes)}
        />
      )}
    </div>
  );
}

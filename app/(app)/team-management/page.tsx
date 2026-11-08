"use client";

import { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Copy, Eye, EyeOff } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkAssignBar } from "@/components/team/bulk-assign-bar";
import { ALL_TEAMS, TeamFilterSelect, selectedTeamIds } from "@/components/team/team-filter-select";
import { applyBulkAssignment, fieldTeamLabel, matchesTeamFilter, sameIdSet } from "@/lib/field-teams";
import { useFieldTeams } from "@/lib/field-teams-context";
import { assignMembersToFieldTeams } from "@/lib/field-teams-actions";
import { MemberRow } from "@/components/team/member-row";
import { MemberEditorDialog } from "@/components/team/member-editor-dialog";
import { MemberAccessDialog } from "@/components/page-access/page-access-panel";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { usePermissions } from "@/lib/permissions";
import { updateMemberAccess, useTeamMembers, type TeamMember } from "@/lib/team-members";
import { getMemberEditState, type MemberAccess } from "@/lib/member-access";

export default function TeamManagementPage() {
  const { user, profile } = useAuth();
  const { team, loaded: teamLoaded } = useTeamDoc(profile?.teamId ?? null);
  const { isAdmin, isOwner } = usePermissions();
  const { members, loaded: membersLoaded } = useTeamMembers(profile?.teamId ?? null);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Bumped on every open so the editor remounts with a draft taken from the member's current values.
  const [editorKey, setEditorKey] = useState(0);
  const [savedUid, setSavedUid] = useState<string | null>(null);
  // P26: the member whose page access is open (the same editor as Admin Panel > Page Access).
  const [accessUid, setAccessUid] = useState<string | null>(null);

  const adminCount = members.filter((m) => m.isAdmin).length;

  // P19: FTC teams — filter the roster by team, and bulk-assign selected members.
  const { fieldTeams, accountName } = useFieldTeams();
  const multiTeam = fieldTeams.length > 1;
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const filterIds = selectedTeamIds(teamFilter, fieldTeams);
  const visibleMembers = useMemo(
    () => members.filter((m) => matchesTeamFilter(m.fieldTeamIds, filterIds, fieldTeams)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, teamFilter, fieldTeams]
  );

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

  const actor = { uid: user?.uid ?? "", isAdmin, isOwner };
  // The roster is realtime: guard and block-reasons use the member's *current* row, while the editor's draft keeps the values it opened with.
  const liveEditing = editing ? (members.find((m) => m.uid === editing.uid) ?? editing) : null;
  const editState = (m: TeamMember) => getMemberEditState(actor, m, adminCount);

  // Only rows the viewer can edit are selectable; the roster is realtime, so re-derive from the live rows each time.
  const selectableUids = visibleMembers.filter((m) => editState(m).canEdit).map((m) => m.uid);
  const liveSelected = members.filter((m) => selected.has(m.uid) && editState(m).canEdit);
  const allShownSelected = selectableUids.length > 0 && selectableUids.every((uid) => selected.has(uid));

  const toggleSelected = (uid: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(uid);
      else next.delete(uid);
      return next;
    });

  const handleBulk = async (teamId: string, mode: "add" | "remove") => {
    if (!user || !profile) return;
    setBulkError(null);
    // Only members that actually change, and only ones the rules would let this admin edit.
    const changes = liveSelected
      .map((m) => ({ uid: m.uid, name: m.name, before: m.fieldTeamIds ?? [], after: applyBulkAssignment(m.fieldTeamIds, teamId, mode, fieldTeams) }))
      .filter((c) => !sameIdSet(c.before, c.after));
    if (changes.length === 0) {
      setBulkError(mode === "add" ? "Everyone selected is already on that team." : "No one selected is on that team.");
      return;
    }
    setBulkBusy(true);
    try {
      await assignMembersToFieldTeams({ teamId: profile.teamId, uid: user.uid, name: profile.name }, changes);
      setSelected(new Set());
    } catch {
      setBulkError("Couldn't save those changes. You may not have permission, or the team list just changed.");
    } finally {
      setBulkBusy(false);
    }
  };

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
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{accountName ?? "Team"}</div>
          {teamLoaded ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {fieldTeams.length === 0 ? (
                <span className="text-xl font-semibold">No FTC team yet</span>
              ) : (
                fieldTeams.map((t) => (
                  <span key={t.id} className="text-xl font-semibold tabular-nums">
                    {fieldTeamLabel(t)}
                    {t.name && <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">{t.name}</span>}
                  </span>
                ))
              )}
            </div>
          ) : (
            <div className="text-xl font-semibold">Loading…</div>
          )}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Members {membersLoaded && (visibleMembers.length === members.length ? `(${members.length})` : `(${visibleMembers.length} of ${members.length})`)}
          </h2>
          {multiTeam && (
            <div className="flex flex-wrap items-center gap-3">
              {selectableUids.length > 0 && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-[var(--muted-foreground)]">
                  <Checkbox
                    checked={allShownSelected}
                    onCheckedChange={(v) => setSelected(v === true ? new Set([...selected, ...selectableUids]) : new Set([...selected].filter((uid) => !selectableUids.includes(uid))))}
                    aria-label="Select everyone shown"
                    className="h-7 w-7"
                  />
                  Select all shown
                </label>
              )}
              <TeamFilterSelect value={teamFilter} onChange={setTeamFilter} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {!membersLoaded ? (
            <div className="glass-card h-16 animate-pulse" />
          ) : members.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No members yet.</p>
          ) : visibleMembers.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No one is on that team yet.</p>
          ) : (
            visibleMembers.map((m) => (
              <MemberRow
                key={m.uid}
                member={m}
                editState={editState(m)}
                highlight={savedUid === m.uid}
                onEdit={() => openEditor(m)}
                onPageAccess={isAdmin ? () => setAccessUid(m.uid) : undefined}
                selection={multiTeam ? { checked: selected.has(m.uid), onChange: (c) => toggleSelected(m.uid, c), disabled: !editState(m).canEdit } : undefined}
              />
            ))
          )}
        </div>
      </GlassPanel>

      <AnimatePresence>
        {multiTeam && liveSelected.length > 0 && (
          <BulkAssignBar
            count={liveSelected.length}
            fieldTeams={fieldTeams}
            busy={bulkBusy}
            error={bulkError}
            onApply={(teamId, mode) => void handleBulk(teamId, mode)}
            onClear={() => {
              setSelected(new Set());
              setBulkError(null);
            }}
          />
        )}
      </AnimatePresence>

      {isAdmin && accessUid && members.some((m) => m.uid === accessUid) && (
        <MemberAccessDialog key={accessUid} member={members.find((m) => m.uid === accessUid)!} open onOpenChange={(o) => !o && setAccessUid(null)} />
      )}

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

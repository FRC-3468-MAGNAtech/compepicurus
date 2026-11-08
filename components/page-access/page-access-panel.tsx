"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { MemberAccessEditor, PreviewAsMember, RequestsList, RoleMatrix } from "@/components/page-access/parts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { setMemberPageState, setRoleGrant, type MemberPageState, type PageAccessConfig } from "@/lib/page-access/access";
import { decidePageAccessRequest, updatePageAccess, usePageAccess, usePageAccessRequests, type PageAccessRequest } from "@/lib/page-access/store";
import { getRole, type RoleId } from "@/lib/roles";
import type { TeamMember } from "@/lib/team-members";
import { useTeamMembers } from "@/lib/team-members";

type Tab = "requests" | "roles" | "members";

const asAccessUser = (m: TeamMember) => ({ uid: m.uid, name: m.name, isAdmin: m.isAdmin, isOwner: m.isOwner, primaryRole: m.primaryRole, secondaryRoles: m.secondaryRoles });

/** One member's editor plus their "Preview as member" (shared by the Members tab and Team Management's Page access dialog). */
export function MemberAccessBody({ member, config, onSet, disabled }: { member: TeamMember; config: PageAccessConfig; onSet: (pageId: string, state: MemberPageState) => void; disabled?: boolean }) {
  const user = asAccessUser(member);
  return (
    <div className="flex flex-col gap-5">
      <MemberAccessEditor member={user} config={config} onSet={onSet} disabled={disabled} />
      {!member.isAdmin && !member.isOwner && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Preview as {member.name}</h3>
          <PreviewAsMember member={user} config={config} />
        </div>
      )}
    </div>
  );
}

/**
 * Admin Panel > Page Access, as plain props: Requests (approve adds a grant, deny declines), the role matrix, and the member
 * overrides with their effective access and "Preview as member". The connected panel below wires it to Firestore.
 */
export function PageAccessPanelView({
  config,
  members,
  requests,
  onToggleRole,
  onSetMemberPage,
  onDecide,
  busyId,
  error,
  initialTab = "roles",
  initialMemberUid,
}: {
  config: PageAccessConfig;
  members: TeamMember[];
  requests: PageAccessRequest[];
  onToggleRole: (role: RoleId, pageId: string, on: boolean) => void;
  onSetMemberPage: (member: TeamMember, pageId: string, state: MemberPageState) => void;
  onDecide: (request: PageAccessRequest, approve: boolean) => void;
  busyId?: string | null;
  error?: string | null;
  initialTab?: Tab;
  initialMemberUid?: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [memberUid, setMemberUid] = useState<string | null>(initialMemberUid ?? null);
  const pending = requests.filter((r) => r.status === "pending").length;
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const member = sorted.find((m) => m.uid === memberUid) ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="page-access-panel">
      <GlassPanel className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <KeyRound className="h-4 w-4" aria-hidden /> Page access
        </h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Choose who can open each restricted page. Admins and the owner can always open everything; the Admin Panel is admin-only. Dashboard, Match Scout Form, Analytics (except Scout Status), Practice Scouting, My Scouting, People, Changelog, Credits, Account Settings and Match List are open to every role.
        </p>
      </GlassPanel>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="max-w-full overflow-x-auto" aria-label="Page access">
          <TabsTrigger value="requests" className="shrink-0 whitespace-nowrap" data-testid="pa-tab-requests">
            Requests
            {pending > 0 && (
              <span className="ml-2 rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary-foreground)]" aria-label={`${pending} waiting`} data-testid="pending-count">
                {pending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="roles" className="shrink-0 whitespace-nowrap" data-testid="pa-tab-roles">
            Roles
          </TabsTrigger>
          <TabsTrigger value="members" className="shrink-0 whitespace-nowrap" data-testid="pa-tab-members">
            Members
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <p role="alert" data-testid="page-access-error" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {tab === "requests" && <RequestsList requests={requests} onDecide={onDecide} busyId={busyId} />}

      {tab === "roles" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--muted-foreground)]">A member can open a page when their primary or a secondary role is ticked. Changes save as you tick.</p>
          <RoleMatrix config={config} onToggle={onToggleRole} />
        </div>
      )}

      {tab === "members" && (
        <div className="flex flex-col gap-4">
          <div className="max-w-sm">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]" htmlFor="pa-member">
              Member
            </label>
            <Select value={memberUid ?? ""} onValueChange={setMemberUid}>
              <SelectTrigger id="pa-member" data-testid="pa-member-select">
                <SelectValue placeholder="Pick a member">{member ? `${member.name} · ${getRole(member.primaryRole).label}` : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sorted.map((m) => (
                  <SelectItem key={m.uid} value={m.uid}>
                    {m.name} · {getRole(m.primaryRole).label}
                    {m.isOwner ? " (owner)" : m.isAdmin ? " (admin)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {member ? (
            <MemberAccessBody member={member} config={config} onSet={(pageId, state) => onSetMemberPage(member, pageId, state)} />
          ) : (
            <p className="glass-card px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">Pick a member to grant or deny pages for them, see where their access comes from, and preview what they see.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** The write helpers both connected views use: each edit is a transaction that applies to the latest stored config. */
function usePageAccessEditing() {
  const { user, profile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const actor = user && profile ? { teamId: profile.teamId, uid: user.uid, name: profile.name } : null;

  const run = async (apply: (c: PageAccessConfig) => PageAccessConfig, change: Record<string, unknown>) => {
    if (!actor) return;
    setError(null);
    try {
      await updatePageAccess(actor, apply, change);
    } catch {
      setError("Couldn't save that change. You may be offline, or no longer allowed to edit page access.");
    }
  };
  return {
    error,
    actor,
    toggleRole: (role: RoleId, pageId: string, on: boolean) => run((c) => setRoleGrant(c, role, pageId, on), { kind: "role", role, pageId, on }),
    setMemberPage: (member: TeamMember, pageId: string, state: MemberPageState) => run((c) => setMemberPageState(c, member.uid, pageId, state), { kind: "member", targetUid: member.uid, targetName: member.name, pageId, state }),
  };
}

/** Admin Panel > Page Access, connected. */
export function PageAccessPanel() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { config } = usePageAccess();
  const { members } = useTeamMembers(teamId);
  const { requests } = usePageAccessRequests(teamId, { all: true, uid: null });
  const edit = usePageAccessEditing();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const decide = async (request: PageAccessRequest, approve: boolean) => {
    if (!edit.actor) return;
    setBusyId(request.id);
    setDecideError(null);
    try {
      await decidePageAccessRequest(edit.actor, request, approve);
    } catch {
      setDecideError("Couldn't save that decision. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageAccessPanelView
      config={config}
      members={members}
      requests={requests}
      onToggleRole={(r, p, on) => void edit.toggleRole(r, p, on)}
      onSetMemberPage={(m, p, s) => void edit.setMemberPage(m, p, s)}
      onDecide={(r, a) => void decide(r, a)}
      busyId={busyId}
      error={edit.error ?? decideError}
      initialTab={requests.some((r) => r.status === "pending") ? "requests" : "roles"}
    />
  );
}

/** Team Management's per-member "Page access" button opens this: the same member editor as Admin Panel > Page Access. */
export function MemberAccessDialog({ member, open, onOpenChange }: { member: TeamMember; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { config } = usePageAccess();
  const edit = usePageAccessEditing();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="pr-8">Page access for {member.name}</DialogTitle>
        <DialogDescription>Their roles open some pages. Grant or deny a page for just them; changes save as you pick.</DialogDescription>
        <div className="mt-4 flex flex-col gap-4" data-testid="member-access-dialog">
          {edit.error && (
            <p role="alert" className="text-sm text-red-300">
              {edit.error}
            </p>
          )}
          <MemberAccessBody member={member} config={config} onSet={(pageId, state) => void edit.setMemberPage(member, pageId, state)} />
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="glass" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

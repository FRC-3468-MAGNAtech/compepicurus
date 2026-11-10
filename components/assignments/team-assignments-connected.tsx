"use client";

import { useMemo, useState } from "react";
import { TeamAssignmentsView, type ScoutOption } from "@/components/assignments/team-assignments-panel";
import { useEventTeams } from "@/lib/analytics/use-event-data";
import { useAuth } from "@/lib/auth";
import { useFormEntries } from "@/lib/form-entries";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { canAccessPage } from "@/lib/page-access/access";
import { usePageAccess } from "@/lib/page-access/store";
import { getRole } from "@/lib/roles";
import { eligibleFormScouts } from "@/lib/scout-status/form-status";
import type { TeamMember } from "@/lib/team-members";
import { TEAM_ASSIGN_KIND_INFO, type TeamAssignKind } from "@/lib/team-assignments/model";
import { KIND_FORM_TYPE, findTeamAssignments, publishTeamAssignments, undoTeamAssignments, useTeamAssignmentDocs } from "@/lib/team-assignments/store";

/** The Pit Scouting / Team Strategy tab on live data: the event's FIRST teams, who can open the form (P26), the published doc, and the person's own entries. */
export function TeamAssignmentsPanel({ kind, eventCode, season, members, attendingUids, canEdit }: { kind: TeamAssignKind; eventCode: string; season: number; members: TeamMember[]; attendingUids: string[]; canEdit: boolean }) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const info = TEAM_ASSIGN_KIND_INFO[kind];
  const { config } = usePageAccess();
  const isOurs = useIsOurTeam();
  const requests = useMemo(() => [{ code: eventCode, season }], [eventCode, season]);
  const { teams } = useEventTeams(requests);
  const { docs } = useTeamAssignmentDocs(teamId);
  const published = findTeamAssignments(docs, eventCode, kind);
  const { entries } = useFormEntries(canEdit ? null : teamId, { eventCode });
  const [publishing, setPublishing] = useState(false);

  const done = useMemo(() => new Set(entries.filter((e) => e.uid === user?.uid && e.formType === KIND_FORM_TYPE[kind] && !e.excluded && typeof e.teamNumber === "number").map((e) => e.teamNumber as number)), [entries, user?.uid, kind]);

  const { eligible, others } = useMemo(() => {
    const canAccess = (uid: string) => {
      const m = members.find((x) => x.uid === uid);
      return !!m && canAccessPage({ uid, isAdmin: m.isAdmin, isOwner: m.isOwner, primaryRole: m.primaryRole, secondaryRoles: m.secondaryRoles }, info.pageId, config);
    };
    const eligibleScouts = eligibleFormScouts({ members, attendingUids: new Set(attendingUids), extraUids: new Set(), canAccess, roleLabel: (r) => getRole(r as never).label });
    const toOption = (s: { uid: string; name: string; role: string | null }): ScoutOption => ({ uid: s.uid, name: s.name, role: s.role });
    const have = new Set(eligibleScouts.map((s) => s.uid));
    return {
      eligible: eligibleScouts.map(toOption),
      others: members.filter((m) => !have.has(m.uid)).map((m) => ({ uid: m.uid, name: m.name, role: getRole(m.primaryRole).label, noAccess: !canAccess(m.uid) })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [members, attendingUids, config, info.pageId]);

  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.name ?? "Someone";

  return (
    <TeamAssignmentsView
      kind={kind}
      teams={teams.map((t) => ({ teamNumber: t.teamNumber, name: t.nameShort }))}
      isOurs={isOurs}
      eligible={eligible}
      others={others}
      published={published}
      canEdit={canEdit}
      me={user?.uid ?? null}
      done={done}
      nameOf={nameOf}
      publishing={publishing}
      onPublish={(version) => {
        if (!teamId || !user) return;
        setPublishing(true);
        publishTeamAssignments(teamId, eventCode, kind, { ...version, generatedBy: user.uid, generatedAt: new Date().toISOString() }, published)
          .catch((err) => console.error("couldn't publish the assignments:", err))
          .finally(() => setPublishing(false));
      }}
      onUndo={() => {
        if (teamId && published) void undoTeamAssignments(teamId, eventCode, kind, published).catch((err) => console.error("couldn't undo:", err));
      }}
    />
  );
}

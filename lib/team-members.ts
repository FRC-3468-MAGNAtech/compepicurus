"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where, writeBatch } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import type { MemberAccess } from "@/lib/member-access";
import type { RoleId } from "@/lib/roles";
import { parseAvatar } from "@/lib/profile/model";
import type { AvatarChoice } from "@/lib/profile/config";

export type TeamMember = {
  uid: string;
  name: string;
  email: string;
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  isAdmin: boolean;
  /** Set only by app/api/auth/sync-roles — see docs/ASSUMPTIONS.md (P1b). Owner rows can't be edited by anyone through the UI (also enforced in firestore.rules). */
  isOwner: boolean;
  /** P19: assigned FTC team ids; absent before the migration. Resolve with assignedFieldTeams() (lib/field-teams.ts) — empty counts as all teams. */
  fieldTeamIds?: string[];
  /** P25: the member's avatar choice (mirrored on the user doc); initials when absent. */
  avatar?: AvatarChoice;
  /** P25: when the account joined the team (ms), from the user doc's createdAt; absent on old docs. */
  joinedAtMs?: number;
};

/** A Firestore Timestamp (or anything with toMillis) as ms; undefined when it isn't one. */
function timestampMs(value: unknown): number | undefined {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return undefined;
}

/** Realtime roster for a team — backs both Team Management (editable, admin-only) and People (read-only). */
export function useTeamMembers(teamId: string | null) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // Deliberate: resets the roster when teamId becomes unavailable (e.g.
      // the profile doc hasn't loaded yet), so a previous team's members
      // never linger on screen for a different (or no) team.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMembers([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, "users"), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setMembers(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              uid: d.id,
              name: data.name,
              email: data.email,
              primaryRole: data.primaryRole,
              secondaryRoles: data.secondaryRoles ?? [],
              isAdmin: !!data.isAdmin,
              isOwner: !!data.isOwner,
              fieldTeamIds: Array.isArray(data.fieldTeamIds) ? (data.fieldTeamIds as string[]) : undefined,
              avatar: data.avatar ? parseAvatar(data.avatar) : undefined,
              joinedAtMs: timestampMs(data.createdAt),
            };
          })
        );
        setLoaded(true);
      },
      (err) => {
        console.error("team members subscription failed:", err);
        setMembers([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { members, loaded };
}

/**
 * FIX1-3: saves whatever the Team Management editor changed (primary role,
 * secondary roles, admin flag) *and* its `edit-member-roles` audit entry
 * (who, whom, before, after) in one atomic batch — so a role change can never
 * land without its audit record, and teammates get a single realtime change.
 * Admin-gated at the call site (lib/member-access.ts's getMemberEditState) and
 * enforced in firestore.rules — owners are untouchable and an admin can't
 * demote themself. No-op when `changes` is empty.
 */
export async function updateMemberAccess(
  actor: { teamId: string; uid: string; name: string },
  member: Pick<TeamMember, "uid" | "name"> & MemberAccess,
  changes: Partial<MemberAccess>
) {
  if (Object.keys(changes).length === 0) return;

  // `fieldTeamIds` only joins the audit record when there is one (Firestore rejects `undefined` field values).
  const before: MemberAccess = {
    primaryRole: member.primaryRole,
    secondaryRoles: member.secondaryRoles,
    isAdmin: member.isAdmin,
    ...(member.fieldTeamIds ? { fieldTeamIds: member.fieldTeamIds } : {}),
  };
  const after: MemberAccess = { ...before, ...changes };

  const batch = writeBatch(db);
  batch.update(doc(db, "users", member.uid), changes);
  batch.set(
    newAuditLogRef(),
    buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-member-roles", { targetUid: member.uid, targetName: member.name }, before, after)
  );
  await batch.commit();
}

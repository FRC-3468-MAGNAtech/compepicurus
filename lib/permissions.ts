"use client";

import { useAuth } from "@/lib/auth";
import { canEditPickList } from "@/lib/pick-list/permissions";

export type PermissionAction = "manageTeam" | "manageScoutData" | "toggleTeamCreation" | "editPickList";

/**
 * Admin-only for most actions; `toggleTeamCreation` is owner-only (P1b) —
 * it's enforced for real on the server (/api/admin/team-creation checks the
 * `owner` custom claim), this just drives the UI so non-owners don't see a
 * control that would 403.
 *
 * `editPickList` (P12) is admins plus anyone whose primary *or* secondary role
 * is Lead Strategist, Lead Scout, Team Coach, or Drive Team — see
 * lib/pick-list/permissions.ts; firestore.rules enforces the same set.
 */
export function usePermissions() {
  const { profile } = useAuth();
  const isAdmin = profile?.isAdmin ?? false;
  const isOwner = profile?.isOwner ?? false;

  function can(action: PermissionAction): boolean {
    switch (action) {
      case "manageTeam":
      case "manageScoutData":
        return isAdmin;
      case "toggleTeamCreation":
        return isOwner;
      case "editPickList":
        return canEditPickList(profile);
      default:
        return false;
    }
  }

  return { isAdmin, isOwner, can };
}

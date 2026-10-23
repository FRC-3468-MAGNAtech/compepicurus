"use client";

import { useAuth } from "@/lib/auth";

export type PermissionAction = "manageTeam" | "manageScoutData" | "toggleTeamCreation";

/**
 * Admin-only for most actions; `toggleTeamCreation` is owner-only (P1b) —
 * it's enforced for real on the server (/api/admin/team-creation checks the
 * `owner` custom claim), this just drives the UI so non-owners don't see a
 * control that would 403.
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
      default:
        return false;
    }
  }

  return { isAdmin, isOwner, can };
}

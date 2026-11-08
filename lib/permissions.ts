"use client";

import { useAuth } from "@/lib/auth";
import { usePageAccess } from "@/lib/page-access/store";
import { canEditPickList } from "@/lib/pick-list/permissions";
import { canManageForms } from "@/lib/forms/permissions";

export type PermissionAction = "manageTeam" | "manageScoutData" | "manageForms" | "toggleTeamCreation" | "reviewApplications" | "editPickList" | "editScoutTargets" | "editAssignments";

/**
 * Admin-only for most actions. P20 split "owner" in two: `isOwner` is the TEAM owner (teams.ownerUid; transfers ownership,
 * has the FIX2 protections) and `isPlatformOwner` is the platform owner (OWNER_EMAILS). `toggleTeamCreation` and
 * `reviewApplications` are platform-owner-only: enforced for real on the server (the routes check the verified
 * token), this just drives the UI so nobody sees a control that would 403.
 *
 * `manageForms` (P22, the Form Builder) is the team owner and admins: firestore.rules' `canManageMembers()` is the same set (the `forms` writes), so a
 * control the UI shows is one the rules will accept. See `canManageForms` (pure, tested in lib/forms/permissions.test.ts).
 *
 * `editScoutTargets` and `editAssignments` (P26) follow the page access of Scout Status and Assignments (admins, the roles an admin
 * ticked for the page, an explicit grant, minus a deny): the same check as firestore.rules' `pageAccessAllowed()` for those writes.
 *
 * `editPickList` (P12) is admins plus anyone whose primary *or* secondary role
 * is Lead Strategist, Lead Scout, Team Coach, or Drive Team — see
 * lib/pick-list/permissions.ts; firestore.rules enforces the same set.
 */
export function usePermissions() {
  const { profile } = useAuth();
  const isAdmin = profile?.isAdmin ?? false;
  const isOwner = profile?.isOwner ?? false;
  const isPlatformOwner = profile?.isPlatformOwner ?? false;
  const pageAccess = usePageAccess();

  function can(action: PermissionAction): boolean {
    switch (action) {
      case "manageTeam":
      case "manageScoutData":
        return isAdmin;
      case "manageForms":
        return canManageForms({ isAdmin, isOwner });
      case "toggleTeamCreation":
      case "reviewApplications":
        return isPlatformOwner;
      case "editPickList":
        return canEditPickList(profile);
      case "editScoutTargets":
        return pageAccess.can("scout-status");
      case "editAssignments":
        return pageAccess.can("assignments");
      default:
        return false;
    }
  }

  return { isAdmin, isOwner, isPlatformOwner, can };
}

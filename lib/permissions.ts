"use client";

import { useAuth } from "@/lib/auth";

export type PermissionAction = "manageTeam" | "manageScoutData";

/**
 * Admin-only for every action today. Kept as a named helper (rather than
 * inlining `isAdmin` checks everywhere) so later prompts can introduce
 * finer-grained, non-admin-gated actions without touching every call site.
 */
export function usePermissions() {
  const { profile } = useAuth();
  const isAdmin = profile?.isAdmin ?? false;

  function can(action: PermissionAction): boolean {
    switch (action) {
      case "manageTeam":
      case "manageScoutData":
        return isAdmin;
      default:
        return false;
    }
  }

  return { isAdmin, can };
}

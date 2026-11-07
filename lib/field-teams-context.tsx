"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import {
  assignedFieldTeams,
  isOurTeam,
  ourTeamNumbers,
  readFieldTeams,
  resolveActiveFieldTeam,
  type FieldTeam,
} from "@/lib/field-teams";

// P19: one subscription to the account's team doc, shared by everything that needs "which FTC teams are
// ours / which one am I viewing as". Mounted once in app/(app)/layout.tsx. The hooks below never throw
// outside the provider (they return an empty value), so isolated component tests keep working.

export type FieldTeamsValue = {
  /** False until the team doc (and the user's profile) have loaded, so "no FTC team" never flashes. */
  loaded: boolean;
  /** Every FTC team on the account, in the admin's order. */
  fieldTeams: FieldTeam[];
  /** The account's optional display name. */
  accountName: string | null;
  /** The FTC teams this user is assigned to (all of them when none is recorded). */
  assignedFieldTeams: FieldTeam[];
  /** The team being "viewed as"; null only when the account has no FTC team at all. */
  activeFieldTeam: FieldTeam | null;
  setActiveFieldTeam: (id: string) => Promise<void>;
  /** The numbers of every FTC team on the account. */
  ourNumbers: ReadonlySet<number>;
};

/** Pure assembly of the context value, so the default/persistence/removal behaviour is unit-testable without Firebase. */
export function buildFieldTeamsValue(input: {
  loaded: boolean;
  team: { fieldTeams?: unknown; number?: unknown; name?: unknown; accountName?: string | null } | null | undefined;
  userFieldTeamIds?: readonly string[] | null;
  savedActiveId?: string | null;
  setActive?: (id: string) => Promise<void>;
}): FieldTeamsValue {
  const fieldTeams = readFieldTeams(input.team);
  const assigned = assignedFieldTeams(input.userFieldTeamIds, fieldTeams);
  const accountName = typeof input.team?.accountName === "string" && input.team.accountName.trim() ? input.team.accountName.trim() : null;
  return {
    loaded: input.loaded,
    fieldTeams,
    accountName,
    assignedFieldTeams: assigned,
    activeFieldTeam: resolveActiveFieldTeam({ teams: fieldTeams, userFieldTeamIds: input.userFieldTeamIds, savedActiveId: input.savedActiveId }),
    setActiveFieldTeam: input.setActive ?? (async () => {}),
    ourNumbers: ourTeamNumbers(fieldTeams),
  };
}

const EMPTY: FieldTeamsValue = buildFieldTeamsValue({ loaded: true, team: null });

export const FieldTeamsContext = createContext<FieldTeamsValue | null>(null);

export function FieldTeamsProvider({ children }: { children: ReactNode }) {
  const { profile, updateUserProfile } = useAuth();
  const { team, loaded: teamLoaded } = useTeamDoc(profile?.teamId ?? null);

  const setActive = useCallback(
    async (id: string) => {
      await updateUserProfile({ activeFieldTeamId: id });
    },
    [updateUserProfile]
  );

  const value = useMemo(
    () =>
      buildFieldTeamsValue({
        loaded: teamLoaded && profile !== null,
        team,
        userFieldTeamIds: profile?.fieldTeamIds,
        savedActiveId: profile?.activeFieldTeamId,
        setActive,
      }),
    [teamLoaded, profile, team, setActive]
  );

  return <FieldTeamsContext.Provider value={value}>{children}</FieldTeamsContext.Provider>;
}

/** The account's FTC teams (and which ones this user is assigned to). */
export function useFieldTeams(): Pick<FieldTeamsValue, "loaded" | "fieldTeams" | "assignedFieldTeams" | "accountName"> {
  const v = useContext(FieldTeamsContext) ?? EMPTY;
  return { loaded: v.loaded, fieldTeams: v.fieldTeams, assignedFieldTeams: v.assignedFieldTeams, accountName: v.accountName };
}

/** The FTC team the user is currently "viewing as", persisted per user (users/{uid}.activeFieldTeamId), defaulting to their first assigned team. */
export function useActiveFieldTeam(): {
  loaded: boolean;
  activeFieldTeam: FieldTeam | null;
  setActiveFieldTeam: (id: string) => Promise<void>;
  assignedFieldTeams: FieldTeam[];
  /** More than one team to switch between. */
  canSwitch: boolean;
} {
  const v = useContext(FieldTeamsContext) ?? EMPTY;
  return {
    loaded: v.loaded,
    activeFieldTeam: v.activeFieldTeam,
    setActiveFieldTeam: v.setActiveFieldTeam,
    assignedFieldTeams: v.assignedFieldTeams,
    canSwitch: v.assignedFieldTeams.length > 1,
  };
}

/** `isOurTeam(number)`: true for **any** of the account's FTC teams. Stable between renders while the teams don't change. */
export function useIsOurTeam(): (number: number | null | undefined) => boolean {
  const v = useContext(FieldTeamsContext) ?? EMPTY;
  return useCallback((number: number | null | undefined) => isOurTeam(number, v.fieldTeams), [v.fieldTeams]);
}

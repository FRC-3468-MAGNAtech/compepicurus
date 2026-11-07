"use client";

import { authedApi } from "@/lib/api-client";

/** Starts an ownership transfer: the caller must have re-authenticated just before (lib/reauth.ts). */
export const requestOwnershipTransfer = (toUid: string, confirm: string) => authedApi("/api/team/transfer", { method: "POST", body: { action: "request", toUid, confirm } });
export const acceptOwnershipTransfer = () => authedApi("/api/team/transfer", { method: "POST", body: { action: "accept" } });
export const declineOwnershipTransfer = () => authedApi("/api/team/transfer", { method: "POST", body: { action: "decline" } });
export const cancelOwnershipTransfer = () => authedApi("/api/team/transfer", { method: "POST", body: { action: "cancel" } });

/** Platform owner only: the recovery transfer of any account. */
export const forceOwnershipTransfer = (teamId: string, toUid: string, confirm: string, reason: string) =>
  authedApi("/api/team/transfer", { method: "POST", body: { action: "force", teamId, toUid, confirm, reason } });

export type RecoveryTeam = {
  teamId: string;
  accountName: string | null;
  fieldTeams: { number: number; name: string }[];
  ownerUid: string | null;
  ownerName: string | null;
  admins: { uid: string; name: string; email: string }[];
};

export const fetchRecoveryTeams = () => authedApi<{ teams: RecoveryTeam[] }>("/api/admin/teams").then((r) => r.teams);

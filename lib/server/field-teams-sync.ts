import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { planMemberMigration, planTeamMigration, readFieldTeams } from "@/lib/field-teams";

export type FieldTeamsSyncResult = { teamMigrated: boolean; membersMigrated: number };

/**
 * P19 migration for one team account, safe to run any number of times and from any number of
 * sign-ins at once:
 *  1. In a transaction, give the team doc `fieldTeams` (from its legacy `number`/`name`, ids from
 *     `migratedFieldTeamId`) and the `fieldTeamIdList` mirror — only if either is missing or stale.
 *  2. Give every member that has **no** `fieldTeamIds` list all of the account's FTC teams, so
 *     nobody loses sight of anything. Members who already have a list are never touched, so an
 *     admin's later assignments are never overwritten.
 * The legacy `number` is kept (and keeps being read as a fallback). The plans are pure
 * (lib/field-teams.ts) and unit-tested; this wrapper is exercised by the emulator tests.
 */
export async function syncFieldTeams(db: Firestore, teamId: string): Promise<FieldTeamsSyncResult> {
  const teamRef = db.collection("teams").doc(teamId);

  const teamMigrated = await db.runTransaction(async (txn) => {
    const snap = await txn.get(teamRef);
    if (!snap.exists) return false;
    const plan = planTeamMigration(snap.data());
    if (!plan) return false;
    txn.update(teamRef, plan);
    return true;
  });

  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) return { teamMigrated, membersMigrated: 0 };
  const teams = readFieldTeams(teamSnap.data());
  if (teams.length === 0) return { teamMigrated, membersMigrated: 0 };

  const membersSnap = await db.collection("users").where("teamId", "==", teamId).get();
  const plan = planMemberMigration(
    membersSnap.docs.map((d) => ({ uid: d.id, fieldTeamIds: d.data().fieldTeamIds })),
    teams
  );

  // Firestore batches hold at most 500 writes; an account is a few dozen people, but chunk anyway.
  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 400)) batch.update(db.collection("users").doc(p.uid), { fieldTeamIds: p.fieldTeamIds });
    await batch.commit();
  }

  return { teamMigrated, membersMigrated: plan.length };
}

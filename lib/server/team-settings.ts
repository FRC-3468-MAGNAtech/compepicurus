import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";

export const APP_SETTINGS_PATH = "appSettings/global";

export function randomJoinCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** The default when appSettings/global doesn't exist yet: enabled only if no team exists. */
async function computeDefaultTeamCreationEnabled(db: Firestore, txn?: Transaction): Promise<boolean> {
  const teamsQuery = db.collection("teams").limit(1);
  const snap = txn ? await txn.get(teamsQuery) : await teamsQuery.get();
  return snap.empty;
}

/**
 * Plain (non-transactional) read for the public config route: if the
 * settings doc doesn't exist yet, computes and persists the default so
 * later reads (and the create-team transaction) see a stable value instead
 * of recomputing "does any team exist" forever.
 */
export async function getTeamCreationEnabled(db: Firestore): Promise<boolean> {
  const ref = db.doc(APP_SETTINGS_PATH);
  const snap = await ref.get();
  if (snap.exists) return Boolean(snap.data()?.teamCreationEnabled);
  const computed = await computeDefaultTeamCreationEnabled(db);
  await ref.set({ teamCreationEnabled: computed }, { merge: true });
  return computed;
}

/**
 * Transaction-safe read for /api/team/create — reads (and, if missing,
 * computes but does not persist — the transaction's own write does that)
 * the current value. Must be called before any writes in the same
 * transaction, per Firestore's reads-before-writes rule.
 */
export async function getTeamCreationEnabledInTransaction(db: Firestore, txn: Transaction): Promise<boolean> {
  const ref = db.doc(APP_SETTINGS_PATH);
  const snap = await txn.get(ref);
  if (snap.exists) return Boolean(snap.data()?.teamCreationEnabled);
  return computeDefaultTeamCreationEnabled(db, txn);
}

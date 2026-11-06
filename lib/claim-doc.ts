import { doc, runTransaction, type Firestore } from "firebase/firestore";

/**
 * One attempt to reserve `collection/id`: in a transaction, read the doc and,
 * only if it doesn't exist, create it with `initialData`. Returns false when
 * someone already holds the id. This is how Session IDs and lobby codes are
 * made unique (lib/practice-sessions.ts claimUniqueDocId) — it is a *read of a
 * document that doesn't exist yet*, which firestore.rules must allow (FIX3) —
 * and the rules regression suite runs this exact function.
 */
export async function tryClaimDoc(db: Firestore, collectionName: string, id: string, initialData: Record<string, unknown>): Promise<boolean> {
  const ref = doc(db, collectionName, id);
  return runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    if (snap.exists()) return false;
    txn.set(ref, initialData);
    return true;
  });
}

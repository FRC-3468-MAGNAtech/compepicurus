"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { FORM_DEFAULT_FRACTION, SPLIT_DEFAULT, WORKSPACE_STORAGE_KEYS, clampSplit, parseFraction, readFraction, resolveFraction, writeFraction } from "@/lib/workspace/layout";

// P24: the ScoutingWorkspace's remembered layout: how wide the form is (a share of the workspace) and, on phones, how the screen splits between video and form.
// Saved on the signed-in user's own doc (`users/{uid}.workspaceFormWidth`, `workspacePhoneSplit`) so it follows them across devices, and in this browser
// (localStorage) so it applies instantly and works signed out or with storage-blocked accounts. The account's value wins when there is one; a value only this browser
// had is saved to the account the first time. The existing "update your own non-role fields" rule covers the write (no rules change).

const SAVE_DEBOUNCE_MS = 500;
const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

type Field = "workspaceFormWidth" | "workspacePhoneSplit";

function usePersistedFraction(field: Field, storageKey: string, fallback: number, clamp: (n: number) => number) {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? null;
  const profileValue = profile?.[field];
  const [local, setLocal] = useState<number | null>(() => readFraction(storage(), storageKey));
  const timer = useRef<number | null>(null);
  const pending = useRef<{ uid: string; value: number } | null>(null);

  const value = clamp(resolveFraction(profileValue, local, fallback));

  const flush = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (p && isFirebaseConfigured()) updateDoc(doc(db, "users", p.uid), { [field]: p.value }).catch((err) => console.error(`couldn't save ${field}:`, err));
  }, [field]);

  const set = useCallback(
    (next: number) => {
      const v = clamp(next);
      setLocal(v);
      writeFraction(storage(), storageKey, v);
      if (!uid || !isFirebaseConfigured()) return;
      pending.current = { uid, value: v };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [uid, storageKey, flush, clamp]
  );

  // A value only this browser has is saved to the account once the profile is known.
  const migrated = useRef(false);
  useEffect(() => {
    if (!uid || migrated.current || profile === null) return;
    migrated.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time: saves a value only this browser had to the account
    if (parseFraction(profileValue) === null && local !== null) set(local);
  }, [uid, profile, profileValue, local, set]);

  // A pending debounced save isn't lost when the workspace closes.
  useEffect(() => flush, [flush]);

  return [value, set] as const;
}

const clampForm = (n: number) => n;

/** The remembered form width (share of the workspace) and phone split (video's share of the height). */
export function useWorkspacePrefs() {
  const [formFraction, setFormFraction] = usePersistedFraction("workspaceFormWidth", WORKSPACE_STORAGE_KEYS.formFraction, FORM_DEFAULT_FRACTION, clampForm);
  const [phoneSplit, setPhoneSplit] = usePersistedFraction("workspacePhoneSplit", WORKSPACE_STORAGE_KEYS.phoneSplit, SPLIT_DEFAULT, clampSplit);
  return { formFraction, setFormFraction, phoneSplit, setPhoneSplit };
}

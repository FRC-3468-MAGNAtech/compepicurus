"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { AvatarChoice, ProfileVisibility } from "@/lib/profile/config";
import { parseProfile, type ProfileDoc } from "@/lib/profile/model";

// P25: reading and writing profiles/{uid}. The rules are the privacy boundary (firestore.rules); this is the plumbing.

export type ProfileState =
  /** Waiting for the first answer. */
  | { status: "loading" }
  /** `profile` is null while the member has never saved one (the defaults apply). */
  | { status: "ready"; profile: ProfileDoc | null }
  /** The rules said no: a private profile, seen by a non-admin teammate. Shown as the limited card, never as an error. */
  | { status: "denied" }
  | { status: "error" };

/**
 * Live profile of one member. A change of visibility while someone is looking turns "ready" into "denied" (and back)
 * at once, because the listener is re-evaluated against the rules.
 */
export function useProfile(uid: string | null, teamId: string | null): ProfileState {
  const [held, setHeld] = useState<{ key: string; state: ProfileState } | null>(null);
  const key = uid && teamId ? `${uid}|${teamId}` : null;

  useEffect(() => {
    if (!uid || !teamId || !isFirebaseConfigured()) return;
    const k = `${uid}|${teamId}`;
    const unsubscribe = onSnapshot(
      doc(db, "profiles", uid),
      (snap) => setHeld({ key: k, state: { status: "ready", profile: snap.exists() ? parseProfile(snap.data(), teamId) : null } }),
      (err) => {
        if ((err as { code?: string }).code === "permission-denied") setHeld({ key: k, state: { status: "denied" } });
        else {
          reportFirestoreError("profile subscription failed", err, `profiles/${uid}`);
          setHeld({ key: k, state: { status: "error" } });
        }
      }
    );
    return unsubscribe;
  }, [uid, teamId]);

  if (!key || !isFirebaseConfigured()) return { status: "ready", profile: null };
  return held?.key === key ? held.state : { status: "loading" };
}

export type ProfileEdit = {
  displayName: string;
  bio: string;
  pronouns: string;
  avatar: AvatarChoice;
  visibility: ProfileVisibility;
};

/**
 * Saves the member's own profile and mirrors the avatar onto their user doc (so teammates and the limited card can
 * show it) in one batch. The caller sanitizes the text (lib/profile/model.ts) and, for an admin, passes the
 * visibility they already have (the rules refuse a change).
 */
export async function saveOwnProfile(actor: { uid: string; teamId: string }, edit: ProfileEdit): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, "profiles", actor.uid), {
    teamId: actor.teamId,
    displayName: edit.displayName,
    bio: edit.bio,
    pronouns: edit.pronouns,
    avatar: edit.avatar,
    visibility: edit.visibility,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, "users", actor.uid), { avatar: edit.avatar });
  await batch.commit();
}

/**
 * Moderation: an admin clears a teammate's bio and pronouns (never writes them) and the `clear-profile-text` audit
 * entry, with what was there, commits in the same batch. The rules allow nothing but this clear.
 */
export async function clearProfileText(
  actor: { teamId: string; uid: string; name: string },
  target: { uid: string; name: string; bio: string; pronouns: string }
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "profiles", target.uid), { bio: "", pronouns: "", updatedAt: serverTimestamp() });
  batch.set(
    newAuditLogRef(),
    buildAuditEntry(
      actor.teamId,
      actor.uid,
      actor.name,
      "clear-profile-text",
      { targetUid: target.uid, targetName: target.name },
      { bio: target.bio, pronouns: target.pronouns },
      { bio: "", pronouns: "" }
    )
  );
  await batch.commit();
}

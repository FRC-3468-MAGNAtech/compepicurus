"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { RoleId } from "@/lib/roles";

export type TeamMember = {
  uid: string;
  name: string;
  email: string;
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  isAdmin: boolean;
};

/** Realtime roster for a team — backs both Team Management (editable, admin-only) and People (read-only). */
export function useTeamMembers(teamId: string | null) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // Deliberate: resets the roster when teamId becomes unavailable (e.g.
      // the profile doc hasn't loaded yet), so a previous team's members
      // never linger on screen for a different (or no) team.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMembers([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, "users"), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(q, (snap) => {
      setMembers(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            name: data.name,
            email: data.email,
            primaryRole: data.primaryRole,
            secondaryRoles: data.secondaryRoles ?? [],
            isAdmin: !!data.isAdmin,
          };
        })
      );
      setLoaded(true);
    });
    return unsubscribe;
  }, [teamId]);

  return { members, loaded };
}

export async function setMemberPrimaryRole(uid: string, role: RoleId) {
  await updateDoc(doc(db, "users", uid), { primaryRole: role });
}

export async function setMemberSecondaryRoles(uid: string, roles: RoleId[]) {
  await updateDoc(doc(db, "users", uid), { secondaryRoles: roles });
}

export async function setMemberAdmin(uid: string, isAdmin: boolean) {
  await updateDoc(doc(db, "users", uid), { isAdmin });
}

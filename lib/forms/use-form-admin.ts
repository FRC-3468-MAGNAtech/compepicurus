"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { createFirestoreFormStore } from "@/lib/forms/firestore-store";
import type { FormActor } from "@/lib/forms/actions";
import type { FormStore } from "@/lib/forms/store";
import { usageByForm, type FormUsage } from "@/lib/forms/usage";
import { useTeamMembers } from "@/lib/team-members";
import { useTeamScoutEntries } from "@/lib/scout-entries";

/**
 * Everything the Forms admin tab needs from the account: the Firestore form store bound to this admin, who they are for the audit log,
 * how many entries each form has (an unversioned-aware count), and a uid -> name map for "last edited by".
 */
export function useFormAdmin(): {
  teamId: string | null;
  actor: FormActor | null;
  store: FormStore | null;
  usage: ReadonlyMap<string, FormUsage>;
  entriesLoaded: boolean;
  nameOf: (uid: string | undefined) => string;
} {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const uid = user?.uid ?? null;
  const name = profile?.name ?? "";
  const { entries, loaded: entriesLoaded } = useTeamScoutEntries(teamId);
  const { members } = useTeamMembers(teamId);
  const usage = useMemo(() => usageByForm(entries), [entries]);
  const store = useMemo(() => (teamId && uid ? createFirestoreFormStore(teamId, { uid }) : null), [teamId, uid]);
  const actor = useMemo<FormActor | null>(() => (teamId && uid ? { teamId, uid, name } : null), [teamId, uid, name]);
  const names = useMemo(() => new Map(members.map((m) => [m.uid, m.name])), [members]);
  const nameOf = useMemo(() => (id: string | undefined) => (id ? (names.get(id) ?? "a former member") : "—"), [names]);
  return { teamId, actor, store, usage, entriesLoaded, nameOf };
}

"use client";

import { auth } from "@/lib/firebase/client";

export type CreateTeamResult = { joinCode: string; teamId: string };

async function authedPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  if (!auth.currentUser) throw new Error("Not signed in.");
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "Something went wrong.");
  }
  return json;
}

/** Validates a join code server-side and creates the caller's user doc — see app/api/team/join/route.ts. */
export async function joinTeam(joinCode: string, name?: string): Promise<void> {
  await authedPost("/api/team/join", { joinCode, name });
}

/** Creates a new team (atomically, and only while enabled) and makes the caller its admin — see app/api/team/create/route.ts. */
export async function createTeam(teamNumber: number, teamName?: string, name?: string): Promise<CreateTeamResult> {
  const result = await authedPost("/api/team/create", { teamNumber, teamName, name });
  return { joinCode: String(result.joinCode), teamId: String(result.teamId) };
}

/** Whether Signup should show "Create a team" — a public, unauthenticated read (see app/api/public/config/route.ts), never a direct Firestore read. */
export async function fetchTeamCreationEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/public/config");
    const json = await res.json();
    return Boolean(json.teamCreationEnabled);
  } catch {
    return false;
  }
}

/** Owner-only — see app/api/admin/team-creation/route.ts. Throws on failure (including "not an owner") so the caller can show it. */
export async function setTeamCreationEnabled(enabled: boolean): Promise<void> {
  await authedPost("/api/admin/team-creation", { enabled });
}

/** Called right after every sign-in — see app/api/auth/sync-roles/route.ts and lib/auth.tsx. */
export async function syncRoles(): Promise<{ changed: boolean }> {
  if (!auth.currentUser) return { changed: false };
  try {
    const result = await authedPost("/api/auth/sync-roles", {});
    return { changed: Boolean(result.changed) };
  } catch {
    return { changed: false };
  }
}

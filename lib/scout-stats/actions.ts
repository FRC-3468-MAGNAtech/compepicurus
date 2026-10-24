"use client";

import { logAuditEvent } from "@/lib/audit-log";
import { deletePracticeSession, updatePracticeSession, type PracticeSession } from "@/lib/practice-sessions";
import { deleteEntry } from "@/lib/scout-entries";

/**
 * Admin-only (`can('manageScoutData')` — gate at the call site; rules
 * enforce it for real too). Matches by `type` rather than array index — the
 * caller only ever has the *active* (non-dismissed) subset of
 * `session.flags` to pick from, whose indices don't line up with the full
 * array this writes back.
 */
export async function dismissSessionFlag(
  teamId: string,
  actorUid: string,
  actorName: string,
  session: PracticeSession,
  flagType: string
): Promise<void> {
  const before = session.flags;
  const after = session.flags.map((f) => (f.type === flagType ? { ...f, dismissed: true } : f));
  await updatePracticeSession(session.id, { flags: after });
  await logAuditEvent(teamId, actorUid, actorName, "dismiss-flag", { sessionId: session.id, scoutUid: session.uid, flagType }, before, after);
}

/** Toggles a practice session's `excluded` flag — "Exclude Score From Percentage Average" / "Include". */
export async function setSessionExcluded(
  teamId: string,
  actorUid: string,
  actorName: string,
  session: PracticeSession,
  excluded: boolean
): Promise<void> {
  await updatePracticeSession(session.id, { excluded });
  await logAuditEvent(
    teamId,
    actorUid,
    actorName,
    excluded ? "exclude-session" : "include-session",
    { sessionId: session.id, scoutUid: session.uid },
    { excluded: session.excluded },
    { excluded }
  );
}

/**
 * Permanently deletes every completed `solo` session (and its scout
 * entries) for one scout in one practice category — "Hard Reset Scout
 * Data," practice-only (Real Event's own data belongs to the team's match
 * records and is never bulk-deletable — see docs/ASSUMPTIONS.md, P5).
 */
export async function hardResetScoutData(
  teamId: string,
  actorUid: string,
  actorName: string,
  targetUid: string,
  targetName: string,
  category: "trial" | "competitive",
  sessions: PracticeSession[]
): Promise<void> {
  const toReset = sessions.filter((s) => s.uid === targetUid && s.kind === "solo" && s.mode === category);
  for (const s of toReset) {
    for (const entryId of s.entryIds) {
      await deleteEntry(entryId);
    }
    await deletePracticeSession(s.id);
  }
  await logAuditEvent(
    teamId,
    actorUid,
    actorName,
    "hard-reset-scout-data",
    { targetUid, targetName, category },
    { sessionCount: toReset.length, entryCount: toReset.reduce((sum, s) => sum + s.entryIds.length, 0) },
    { sessionCount: 0, entryCount: 0 }
  );
}

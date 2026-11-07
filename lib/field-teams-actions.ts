"use client";

import { doc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { fieldTeamsWrite, type FieldTeam } from "@/lib/field-teams";

type Actor = { teamId: string; uid: string; name: string };

/**
 * P19: saves Team Settings — the account name and the FTC team list — in one atomic batch together
 * with its `edit-field-teams` audit entry and any member reassignments (members who were on a team
 * that is being removed). Admin/owner-gated at the call site and in firestore.rules, which checks
 * the member writes against the *post-batch* team doc (`getAfter`), so adding a team and assigning
 * people to it can share a batch.
 */
export async function saveTeamSettings(input: {
  actor: Actor;
  before: { accountName: string | null; fieldTeams: FieldTeam[] };
  after: { accountName: string | null; fieldTeams: FieldTeam[] };
  reassignments: { uid: string; name: string; before: string[]; after: string[] }[];
}) {
  const { actor, before, after, reassignments } = input;
  const batch = writeBatch(db);
  batch.update(doc(db, "teams", actor.teamId), { ...fieldTeamsWrite(after.fieldTeams), accountName: after.accountName });
  for (const r of reassignments) batch.update(doc(db, "users", r.uid), { fieldTeamIds: r.after });
  batch.set(
    newAuditLogRef(),
    buildAuditEntry(
      actor.teamId,
      actor.uid,
      actor.name,
      "edit-field-teams",
      { reassigned: reassignments.map((r) => ({ uid: r.uid, name: r.name, before: r.before, after: r.after })) },
      { accountName: before.accountName, fieldTeams: before.fieldTeams },
      { accountName: after.accountName, fieldTeams: after.fieldTeams }
    )
  );
  await batch.commit();
}

/**
 * P19: Team Management's bulk action — one batch that updates each member's `fieldTeamIds` and writes
 * one `edit-member-teams` audit entry per member (who, whom, before, after), so nothing lands
 * without its record. Callers pass only members that actually change.
 */
export async function assignMembersToFieldTeams(actor: Actor, changes: { uid: string; name: string; before: string[]; after: string[] }[]) {
  if (changes.length === 0) return;
  const batch = writeBatch(db);
  for (const c of changes) {
    batch.update(doc(db, "users", c.uid), { fieldTeamIds: c.after });
    batch.set(
      newAuditLogRef(),
      buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-member-teams", { targetUid: c.uid, targetName: c.name }, { fieldTeamIds: c.before }, { fieldTeamIds: c.after })
    );
  }
  await batch.commit();
}

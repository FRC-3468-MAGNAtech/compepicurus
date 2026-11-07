import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { AuditAction } from "@/lib/audit-log";

/**
 * P20: audit entries written by the server routes (Admin SDK). Same shape as the client's `buildAuditEntry`
 * (lib/audit-log.ts), so they show up in Admin Panel > Audit Log like every other action.
 */
export function teamAuditDoc(teamId: string, uid: string, actorName: string, action: AuditAction, target: Record<string, unknown>, before: unknown, after: unknown) {
  return { teamId, uid, actorName, action, target, before: before ?? null, after: after ?? null, createdAt: FieldValue.serverTimestamp() };
}

export type PlatformAuditAction =
  | "submit-application"
  | "approve-application"
  | "reject-application"
  | "block-application"
  | "unblock"
  | "force-transfer-ownership"
  | "approve-template"
  | "reject-template"
  | "takedown-template"
  | "set-official-template"
  | "dismiss-template-reports"
  | "seed-official-templates";

/** The platform owner's own log (`platformAuditLog`, readable only by platform owners): it may hold applicant details that must not appear in any team's Audit Log. */
export function platformAuditDoc(action: PlatformAuditAction, actor: { uid: string; name: string }, details: Record<string, unknown>) {
  return { action, actorUid: actor.uid, actorName: actor.name, details, createdAt: FieldValue.serverTimestamp() };
}

import "server-only";
import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { platformAuditDoc, teamAuditDoc } from "@/lib/server/audit";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { notifyPlatformOwnersOfTemplate } from "@/lib/server/notify-platform-owners";
import { appBaseUrl, sendEmail } from "@/lib/server/email";
import { emailTemplates } from "@/lib/server/email-templates";
import { stripHtml } from "@/lib/forms/sanitize";
import { buildTemplateContent, checksumMatches, TEMPLATE_LIMITS, type FormTemplate, type TemplateContent } from "@/lib/templates/build";
import { OFFICIAL_AUTHOR, officialTemplates } from "@/lib/templates/official";
import type { Form } from "@/lib/forms/types";

// P23: every transition of a template that isn't "an author edits their own private template" happens here (Admin SDK): asking to publish, sending an
// update to a public template, unpublishing, the platform owner's approve / reject / take down / mark official / seed, reports, and counting a use.
// firestore.rules refuse all of those from a client (a client may only create, edit and delete a template while it is private), so moderation can't be
// bypassed and `importCount` can't be inflated from a browser. Each action re-validates the template on the server; nothing public is trusted.

export class TemplateRouteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const HOUR_MS = 60 * 60 * 1000;
const COL = "formTemplates";

type Caller = { uid: string; name: string; teamId: string | null; canManage: boolean; platform: boolean };

async function loadCaller(db: Firestore, decoded: DecodedIdToken): Promise<Caller> {
  const snap = await db.collection("users").doc(decoded.uid).get();
  const u = snap.exists ? snap.data()! : null;
  return {
    uid: decoded.uid,
    name: typeof u?.name === "string" ? u.name : "Someone",
    teamId: typeof u?.teamId === "string" ? u.teamId : null,
    canManage: !!u && (u.isAdmin === true || u.isOwner === true),
    platform: isPlatformOwnerToken(decoded),
  };
}

function requireManager(c: Caller): asserts c is Caller & { teamId: string } {
  if (!c.teamId) throw new TemplateRouteError(403, "no-team", "You're not on a team account.");
  if (!c.canManage) throw new TemplateRouteError(403, "forbidden", "Only the team owner and admins can do that.");
}

function requirePlatform(c: Caller): void {
  if (!c.platform) throw new TemplateRouteError(403, "forbidden", "Only the platform owner can do that.");
}

function toTemplate(id: string, d: DocumentData): FormTemplate {
  return { ...(d as Omit<FormTemplate, "id">), id } as FormTemplate;
}

async function load(db: Firestore, id: unknown) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new TemplateRouteError(400, "bad-request", "Which template?");
  const ref = db.collection(COL).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new TemplateRouteError(404, "not-found", "That template doesn't exist.");
  return { ref, template: toTemplate(id, snap.data()!) };
}

const cleanReason = (v: unknown): string => {
  const reason = typeof v === "string" ? stripHtml(v).replace(/\s+/g, " ").trim().slice(0, TEMPLATE_LIMITS.reason) : "";
  if (reason.length < 3) throw new TemplateRouteError(400, "reason-required", "Give a reason (a few words at least).");
  return reason;
};

/** The template's stored content, re-validated as if it were being published now (a stored template is never trusted). */
function revalidate(t: Pick<FormTemplate, "name" | "description" | "tags" | "form" | "checksum">): TemplateContent {
  if (!checksumMatches(t)) throw new TemplateRouteError(400, "damaged", "This template's checksum doesn't match its contents, so it can't be published. Save it again from the form.");
  const built = buildTemplateContent({ form: t.form, name: t.name, description: t.description, tags: t.tags });
  if (!built.ok) throw new TemplateRouteError(400, "invalid-template", built.errors.slice(0, 3).join(" "));
  if (built.notes.length > 0) throw new TemplateRouteError(400, "unsafe-text", "The template's text contains HTML. Save it again from the form to clean it.");
  return built.content;
}

async function pendingCount(db: Firestore, teamId: string): Promise<number> {
  const [requested, updates] = await Promise.all([
    db.collection(COL).where("ownerTeamId", "==", teamId).where("visibility", "==", "public-pending").get(),
    db.collection(COL).where("ownerTeamId", "==", teamId).where("hasPendingUpdate", "==", true).get(),
  ]);
  return requested.size + updates.size;
}

async function guardRequest(db: Firestore, teamId: string, alreadyPending: boolean): Promise<void> {
  const limit = await consumeRateLimit(db, `tplreq_${teamId}`, TEMPLATE_LIMITS.requestsPerHour, HOUR_MS);
  if (!limit.allowed) throw new TemplateRouteError(429, "rate-limited", "You've sent several template requests recently. Try again in an hour.");
  if (!alreadyPending && (await pendingCount(db, teamId)) >= TEMPLATE_LIMITS.pendingPerAccount) {
    throw new TemplateRouteError(429, "pending-cap", `Your account already has ${TEMPLATE_LIMITS.pendingPerAccount} templates waiting for review. Wait for a decision first.`);
  }
}

/** The email of whoever owns the account (best effort), for decisions. */
async function authorContact(db: Firestore, teamId: string): Promise<{ email: string; name: string } | null> {
  try {
    const team = await db.collection("teams").doc(teamId).get();
    const ownerUid = team.data()?.ownerUid as string | undefined;
    if (!ownerUid) return null;
    const u = await db.collection("users").doc(ownerUid).get();
    const email = u.data()?.email as string | undefined;
    return email ? { email, name: (u.data()?.name as string | undefined) ?? "there" } : null;
  } catch {
    return null;
  }
}

async function tellAuthor(db: Firestore, t: FormTemplate, decision: "approved" | "rejected" | "update-rejected" | "taken-down", reason?: string): Promise<void> {
  const contact = await authorContact(db, t.ownerTeamId);
  if (contact) await sendEmail(emailTemplates.templateDecision({ to: contact.email, name: contact.name, templateName: t.name, decision, reason, appUrl: `${appBaseUrl()}/admin` }));
}

type Body = Record<string, unknown>;

export async function handleTemplateAction(db: Firestore, decoded: DecodedIdToken, body: Body): Promise<Record<string, unknown>> {
  const action = typeof body.action === "string" ? body.action : "";
  const c = await loadCaller(db, decoded);
  const now = Date.now();

  switch (action) {
    // --- the author -------------------------------------------------------------------------------------------------------
    case "request-publish": {
      requireManager(c);
      const { ref, template: t } = await load(db, body.id);
      if (t.ownerTeamId !== c.teamId) throw new TemplateRouteError(403, "forbidden", "That isn't your template.");
      if (t.visibility !== "private" && t.visibility !== "rejected") throw new TemplateRouteError(409, "wrong-state", t.visibility === "public" ? "It's already public." : "It's already waiting for review.");
      await guardRequest(db, c.teamId, false);
      revalidate(t);
      const batch = db.batch();
      batch.update(ref, { visibility: "public-pending", requestedAt: now, updatedAt: now, rejectionReason: FieldValue.delete() });
      batch.set(db.collection("auditLog").doc(), teamAuditDoc(c.teamId, c.uid, c.name, "request-template-publish", { templateId: t.id, name: t.name }, { visibility: t.visibility }, { visibility: "public-pending" }));
      await batch.commit();
      await notifyPlatformOwnersOfTemplate(db, { templateId: t.id, templateName: t.name, authorName: t.authorName, update: false });
      return { ok: true, visibility: "public-pending" };
    }

    case "update-public": {
      // a new version of a template that is already public: it waits for review, and the approved version stays live meanwhile
      requireManager(c);
      const { ref, template: t } = await load(db, body.id);
      if (t.ownerTeamId !== c.teamId) throw new TemplateRouteError(403, "forbidden", "That isn't your template.");
      if (t.visibility !== "public") throw new TemplateRouteError(409, "wrong-state", "Only a public template is updated this way.");
      await guardRequest(db, c.teamId, t.hasPendingUpdate === true);
      const built = buildTemplateContent({
        form: (body.form ?? t.form) as Form,
        name: typeof body.name === "string" ? body.name : t.name,
        description: typeof body.description === "string" ? body.description : t.description,
        tags: Array.isArray(body.tags) ? (body.tags as unknown[]).filter((x): x is string => typeof x === "string") : t.tags,
      });
      if (!built.ok) throw new TemplateRouteError(400, "invalid-template", built.errors.slice(0, 3).join(" "));
      if (built.content.checksum === t.checksum && built.content.name === t.name && built.content.description === t.description && built.content.tags.join() === t.tags.join()) {
        throw new TemplateRouteError(409, "no-change", "That's the same as the version that's already public.");
      }
      const batch = db.batch();
      batch.set(ref.collection("updates").doc("pending"), { ...built.content, version: t.version + 1, requestedAt: now });
      batch.update(ref, { hasPendingUpdate: true, updatedAt: now });
      batch.set(db.collection("auditLog").doc(), teamAuditDoc(c.teamId, c.uid, c.name, "request-template-publish", { templateId: t.id, name: t.name, update: true }, { version: t.version }, { version: t.version + 1 }));
      await batch.commit();
      await notifyPlatformOwnersOfTemplate(db, { templateId: t.id, templateName: t.name, authorName: t.authorName, update: true });
      return { ok: true, pendingVersion: t.version + 1 };
    }

    case "unpublish": {
      requireManager(c);
      const { ref, template: t } = await load(db, body.id);
      if (t.ownerTeamId !== c.teamId) throw new TemplateRouteError(403, "forbidden", "That isn't your template.");
      if (t.visibility !== "public" && t.visibility !== "public-pending") throw new TemplateRouteError(409, "wrong-state", "It isn't public or waiting for review.");
      const batch = db.batch();
      batch.update(ref, { visibility: "private", updatedAt: now, hasPendingUpdate: FieldValue.delete(), rejectionReason: FieldValue.delete() });
      batch.delete(ref.collection("updates").doc("pending"));
      batch.set(db.collection("auditLog").doc(), teamAuditDoc(c.teamId, c.uid, c.name, "unpublish-template", { templateId: t.id, name: t.name }, { visibility: t.visibility }, { visibility: "private" }));
      await batch.commit();
      return { ok: true, visibility: "private" };
    }

    // --- anyone on an account ---------------------------------------------------------------------------------------------------
    case "report": {
      requireManager(c);
      const { ref, template: t } = await load(db, body.id);
      if (t.visibility !== "public") throw new TemplateRouteError(409, "wrong-state", "Only public templates can be reported.");
      if (t.ownerTeamId === c.teamId) throw new TemplateRouteError(400, "own-template", "That's your own template.");
      const reason = cleanReason(body.reason);
      const limit = await consumeRateLimit(db, `tplrep_${c.teamId}`, 10, HOUR_MS);
      if (!limit.allowed) throw new TemplateRouteError(429, "rate-limited", "You've sent several reports recently. Try again later.");
      const reportRef = ref.collection("reports").doc(c.teamId);
      await db.runTransaction(async (txn) => {
        if ((await txn.get(reportRef)).exists) throw new TemplateRouteError(409, "already-reported", "Your account has already reported this template.");
        txn.set(reportRef, { teamId: c.teamId, uid: c.uid, name: c.name, reason, at: now });
        txn.update(ref, { reportCount: FieldValue.increment(1) });
      });
      return { ok: true };
    }

    case "import": {
      // returns the template for the caller to copy, and counts the use once per account
      requireManager(c);
      const { ref, template: t } = await load(db, body.id);
      const own = t.ownerTeamId === c.teamId;
      if (t.visibility !== "public" && !own) throw new TemplateRouteError(403, "forbidden", "That template isn't available to you.");
      if (!checksumMatches(t)) throw new TemplateRouteError(500, "damaged", "This template is damaged. Tell the platform owner.");
      if (t.visibility === "public" && !own) {
        const importRef = ref.collection("imports").doc(c.teamId);
        await db.runTransaction(async (txn) => {
          if ((await txn.get(importRef)).exists) return;
          txn.set(importRef, { teamId: c.teamId, uid: c.uid, at: now });
          txn.update(ref, { importCount: FieldValue.increment(1) });
        });
      }
      return { ok: true, template: { id: t.id, version: t.version, name: t.name, description: t.description, tags: t.tags, form: t.form, checksum: t.checksum } };
    }

    // --- the platform owner -----------------------------------------------------------------------------------------------------
    case "approve": {
      requirePlatform(c);
      const { ref, template: t } = await load(db, body.id);
      const batch = db.batch();
      if (t.hasPendingUpdate) {
        const pendingSnap = await ref.collection("updates").doc("pending").get();
        if (!pendingSnap.exists) throw new TemplateRouteError(409, "wrong-state", "The update isn't there any more.");
        const p = pendingSnap.data()!;
        const content = revalidate({ name: p.name, description: p.description, tags: p.tags, form: p.form, checksum: p.checksum });
        batch.update(ref, { ...content, version: p.version, hasPendingUpdate: FieldValue.delete(), updatedAt: now, publishedAt: now });
        batch.delete(ref.collection("updates").doc("pending"));
      } else if (t.visibility === "public-pending") {
        revalidate(t);
        batch.update(ref, { visibility: "public", publishedAt: now, updatedAt: now, rejectionReason: FieldValue.delete() });
      } else {
        throw new TemplateRouteError(409, "wrong-state", "Nothing to approve.");
      }
      batch.set(db.collection("platformAuditLog").doc(), platformAuditDoc("approve-template", { uid: c.uid, name: c.name }, { templateId: t.id, name: t.name, update: !!t.hasPendingUpdate }));
      batch.set(db.collection("auditLog").doc(), teamAuditDoc(t.ownerTeamId, c.uid, "Platform owner", "template-reviewed", { templateId: t.id, name: t.name }, null, { decision: "approved" }));
      await batch.commit();
      await tellAuthor(db, t, "approved");
      return { ok: true };
    }

    case "reject": {
      requirePlatform(c);
      const { ref, template: t } = await load(db, body.id);
      const reason = cleanReason(body.reason);
      const batch = db.batch();
      let decision: "rejected" | "update-rejected";
      if (t.hasPendingUpdate) {
        batch.update(ref, { hasPendingUpdate: FieldValue.delete(), updatedAt: now });
        batch.delete(ref.collection("updates").doc("pending"));
        decision = "update-rejected";
      } else if (t.visibility === "public-pending") {
        batch.update(ref, { visibility: "rejected", rejectionReason: reason, updatedAt: now });
        decision = "rejected";
      } else {
        throw new TemplateRouteError(409, "wrong-state", "Nothing to reject.");
      }
      batch.set(db.collection("platformAuditLog").doc(), platformAuditDoc("reject-template", { uid: c.uid, name: c.name }, { templateId: t.id, name: t.name, reason, decision }));
      batch.set(db.collection("auditLog").doc(), teamAuditDoc(t.ownerTeamId, c.uid, "Platform owner", "template-reviewed", { templateId: t.id, name: t.name }, null, { decision, reason }));
      await batch.commit();
      await tellAuthor(db, t, decision, reason);
      return { ok: true, decision };
    }

    case "take-down": {
      requirePlatform(c);
      const { ref, template: t } = await load(db, body.id);
      if (t.visibility !== "public") throw new TemplateRouteError(409, "wrong-state", "Only a public template can be taken down.");
      const reason = cleanReason(body.reason);
      const batch = db.batch();
      batch.update(ref, { visibility: "rejected", rejectionReason: reason, official: false, hasPendingUpdate: FieldValue.delete(), updatedAt: now });
      batch.delete(ref.collection("updates").doc("pending"));
      batch.set(db.collection("platformAuditLog").doc(), platformAuditDoc("takedown-template", { uid: c.uid, name: c.name }, { templateId: t.id, name: t.name, reason }));
      batch.set(db.collection("auditLog").doc(), teamAuditDoc(t.ownerTeamId, c.uid, "Platform owner", "template-reviewed", { templateId: t.id, name: t.name }, null, { decision: "taken-down", reason }));
      await batch.commit();
      await tellAuthor(db, t, "taken-down", reason);
      return { ok: true };
    }

    case "set-official": {
      requirePlatform(c);
      const { ref, template: t } = await load(db, body.id);
      if (t.visibility !== "public") throw new TemplateRouteError(409, "wrong-state", "Only a public template can be official.");
      const official = body.official === true;
      await ref.update({ official, updatedAt: now });
      await db.collection("platformAuditLog").add(platformAuditDoc("set-official-template", { uid: c.uid, name: c.name }, { templateId: t.id, name: t.name, official }));
      return { ok: true, official };
    }

    case "dismiss-reports": {
      requirePlatform(c);
      const { ref, template: t } = await load(db, body.id);
      const reports = await ref.collection("reports").get();
      const batch = db.batch();
      reports.docs.forEach((d) => batch.delete(d.ref));
      batch.update(ref, { reportCount: 0 });
      batch.set(db.collection("platformAuditLog").doc(), platformAuditDoc("dismiss-template-reports", { uid: c.uid, name: c.name }, { templateId: t.id, name: t.name, reports: reports.size }));
      await batch.commit();
      return { ok: true, dismissed: reports.size };
    }

    case "seed-official": {
      requirePlatform(c);
      const results: { id: string; result: "created" | "updated" | "unchanged" }[] = [];
      for (const o of officialTemplates()) {
        const ref = db.collection(COL).doc(o.id);
        const snap = await ref.get();
        if (!snap.exists) {
          await ref.set({ ...o.content, visibility: "public", ownerTeamId: c.teamId ?? "platform", authorName: OFFICIAL_AUTHOR, official: true, version: 1, importCount: 0, reportCount: 0, createdAt: now, updatedAt: now, publishedAt: now });
          results.push({ id: o.id, result: "created" });
        } else if (snap.data()?.checksum !== o.content.checksum) {
          await ref.update({ ...o.content, version: ((snap.data()?.version as number | undefined) ?? 1) + 1, visibility: "public", official: true, updatedAt: now, publishedAt: now });
          results.push({ id: o.id, result: "updated" });
        } else {
          results.push({ id: o.id, result: "unchanged" });
        }
      }
      await db.collection("platformAuditLog").add(platformAuditDoc("seed-official-templates", { uid: c.uid, name: c.name }, { results }));
      return { ok: true, results };
    }

    default:
      throw new TemplateRouteError(400, "unknown-action", "Unknown action.");
  }
}


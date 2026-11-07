"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where, type DocumentData, type Query } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { authedApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { logAuditEvent } from "@/lib/audit-log";
import { readFieldTeams } from "@/lib/field-teams";
import { buildTemplateContent, TEMPLATE_LIMITS, type FormTemplate } from "@/lib/templates/build";
import { TemplatesContext, type TemplateInput, type TemplateService } from "@/lib/templates/service";

// P23: the real template service: live lists from Firestore (public, this account's, and the review queue for a platform owner), direct writes only
// for an author's own *private* template (what firestore.rules allow), and everything else through /api/templates.

const COL = "formTemplates";
const toTemplate = (id: string, d: DocumentData): FormTemplate => ({ ...(d as Omit<FormTemplate, "id">), id });

function useLive(q: Query<DocumentData> | null): { list: FormTemplate[]; loaded: boolean } {
  const [state, setState] = useState<{ list: FormTemplate[]; loaded: boolean }>({ list: [], loaded: !isFirebaseConfigured() });
  useEffect(() => {
    if (!q) return;
    return onSnapshot(
      q,
      (snap) => setState({ list: snap.docs.map((d) => toTemplate(d.id, d.data())), loaded: true }),
      (err) => {
        console.error("templates subscription failed:", err);
        setState({ list: [], loaded: true });
      }
    );
  }, [q]);
  return q ? state : { list: [], loaded: true };
}

export function TemplatesProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const uid = user?.uid ?? null;
  const name = profile?.name ?? "";
  const isPlatformOwner = profile?.isPlatformOwner ?? false;
  const { team } = useTeamDoc(teamId);

  const ready = isFirebaseConfigured() && !!teamId;
  const publicQ = useMemo(() => (ready ? query(collection(db, COL), where("visibility", "==", "public")) : null), [ready]);
  const mineQ = useMemo(() => (ready ? query(collection(db, COL), where("ownerTeamId", "==", teamId)) : null), [ready, teamId]);
  const queueQ = useMemo(() => (ready && isPlatformOwner ? query(collection(db, COL), where("visibility", "==", "public-pending")) : null), [ready, isPlatformOwner]);
  const pub = useLive(publicQ);
  const mine = useLive(mineQ);
  const queue = useLive(queueQ);

  const authorName = useMemo(() => {
    const account = typeof team?.accountName === "string" ? team.accountName.trim() : "";
    if (account) return account.slice(0, TEMPLATE_LIMITS.authorName);
    const first = readFieldTeams(team)[0];
    return first ? `FTC ${first.number}${first.name ? ` ${first.name}` : ""}`.slice(0, TEMPLATE_LIMITS.authorName) : "A team";
  }, [team]);

  const service = useMemo<TemplateService>(() => {
    const audit = (action: Parameters<typeof logAuditEvent>[3], target: Record<string, unknown>, before: unknown = null, after: unknown = null) =>
      teamId && uid ? logAuditEvent(teamId, uid, name, action, target, before, after) : Promise.resolve();
    const api = (body: Record<string, unknown>) => authedApi<Record<string, any>>("/api/templates", { body }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const build = (input: TemplateInput) => {
      const r = buildTemplateContent(input);
      if (!r.ok) throw new Error(r.errors[0]);
      return r.content;
    };
    return {
      loaded: pub.loaded && mine.loaded,
      publicTemplates: pub.list,
      mine: mine.list,
      isPlatformOwner,
      queue: queue.list,
      teamId,
      async getTemplate(id) {
        const snap = await getDoc(doc(db, COL, id));
        return snap.exists() ? toTemplate(snap.id, snap.data()) : null;
      },
      async create(input) {
        if (!teamId) throw new Error("You're not on a team account.");
        const content = build(input);
        const now = Date.now();
        const ref = await addDoc(collection(db, COL), { ...content, ownerTeamId: teamId, authorName, visibility: "private", official: false, version: 1, importCount: 0, reportCount: 0, createdAt: now, updatedAt: now });
        await audit("save-form-template", { templateId: ref.id, name: content.name });
        return ref.id;
      },
      async update(id, input) {
        const current = mine.list.find((t) => t.id === id);
        if (!current) throw new Error("That template isn't yours.");
        const content = build(input);
        const changedForm = content.checksum !== current.checksum;
        await updateDoc(doc(db, COL, id), { ...content, version: current.version + (changedForm ? 1 : 0), visibility: "private", rejectionReason: deleteField(), updatedAt: Date.now() });
        await audit("update-form-template", { templateId: id, name: content.name }, { version: current.version }, { version: current.version + (changedForm ? 1 : 0) });
      },
      async remove(id) {
        const current = mine.list.find((t) => t.id === id);
        await deleteDoc(doc(db, COL, id));
        await audit("delete-form-template", { templateId: id, name: current?.name ?? id });
      },
      async requestPublish(id) {
        await api({ action: "request-publish", id });
      },
      async sendUpdate(id, input) {
        const content = build(input);
        await api({ action: "update-public", id, form: content.form, name: content.name, description: content.description, tags: content.tags });
      },
      async unpublish(id) {
        await api({ action: "unpublish", id });
      },
      async report(id, reason) {
        await api({ action: "report", id, reason });
      },
      async use(id) {
        const r = await api({ action: "import", id });
        const t = r.template as FormTemplate;
        await audit("use-form-template", { templateId: t.id, name: t.name, version: t.version });
        return t;
      },
      async getPendingUpdate(id) {
        const snap = await getDoc(doc(db, COL, id, "updates", "pending"));
        return snap.exists() ? (snap.data() as never) : null;
      },
      async getReports(id) {
        const snap = await getDocs(collection(db, COL, id, "reports"));
        return snap.docs.map((d) => d.data() as never);
      },
      async approve(id) {
        await api({ action: "approve", id });
      },
      async reject(id, reason) {
        await api({ action: "reject", id, reason });
      },
      async takeDown(id, reason) {
        await api({ action: "take-down", id, reason });
      },
      async setOfficial(id, official) {
        await api({ action: "set-official", id, official });
      },
      async dismissReports(id) {
        await api({ action: "dismiss-reports", id });
      },
      async seedOfficial() {
        const r = await api({ action: "seed-official" });
        return r.results as { id: string; result: string }[];
      },
    };
  }, [pub.list, pub.loaded, mine.list, mine.loaded, queue.list, isPlatformOwner, teamId, uid, name, authorName]);

  return <TemplatesContext.Provider value={service}>{children}</TemplatesContext.Provider>;
}

"use client";

import { useSyncExternalStore } from "react";
import { buildTemplateContent, checksumMatches, TEMPLATE_LIMITS, type FormTemplate, type TemplateContent } from "@/lib/templates/build";
import { officialTemplates, OFFICIAL_AUTHOR } from "@/lib/templates/official";
import type { TemplateInput, TemplateReport, TemplateService } from "@/lib/templates/service";

// P23: an in-memory TemplateService for the Playwright fixture page (app/e2e/form-builder): the same transitions the server and rules enforce, on
// local state, so the library, the review queue and the update flow can be driven in a browser without Firebase. It is not used by the real app.

export type MemoryTemplateOptions = { teamId: string; isPlatformOwner?: boolean; seed: FormTemplate[]; authorName?: string; onAudit?: (what: string, detail: Record<string, unknown>) => void };

export type MemoryTemplates = { subscribe: (listener: () => void) => () => void; getService: () => TemplateService };

/** A tiny external store: the data, and a service object that is rebuilt (so React sees a new value) after every change. */
export function createMemoryTemplates(opts: MemoryTemplateOptions): MemoryTemplates {
  const store = { list: opts.seed, pending: new Map<string, TemplateContent & { version: number }>(), reports: new Map<string, TemplateReport[]>(), used: new Set<string>(), counter: 0 };
  const listeners = new Set<() => void>();
  let cached: TemplateService | null = null;
  const { teamId, isPlatformOwner = false, authorName = "Our team", onAudit } = opts;

  const buildService = (): TemplateService => {
    const commit = (fn: (list: FormTemplate[]) => FormTemplate[]) => {
      store.list = fn(store.list);
      cached = null;
      listeners.forEach((l) => l());
    };
    const find = (id: string): FormTemplate => {
      const t = store.list.find((x) => x.id === id);
      if (!t) throw new Error("That template doesn't exist.");
      return t;
    };
    const patch = (id: string, p: Partial<FormTemplate>) => commit((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));
    const unset = (id: string, key: keyof FormTemplate) =>
      commit((l) =>
        l.map((t) => {
          if (t.id !== id) return t;
          const next = { ...t };
          delete next[key];
          return next;
        })
      );
    const build = (input: TemplateInput): TemplateContent => {
      const r = buildTemplateContent(input);
      if (!r.ok) throw new Error(r.errors[0]);
      return r.content;
    };
    const mineOnly = (id: string) => {
      const t = find(id);
      if (t.ownerTeamId !== teamId) throw new Error("That isn't your template.");
      return t;
    };
    const reason = (r: string) => {
      const clean = r.replace(/<[^>]*>/g, "").trim().slice(0, TEMPLATE_LIMITS.reason);
      if (clean.length < 3) throw new Error("Give a reason (a few words at least).");
      return clean;
    };
    const platform = () => {
      if (!isPlatformOwner) throw new Error("Only the platform owner can do that.");
    };
    const visible = store.list;
    return {
      loaded: true,
      publicTemplates: visible.filter((t) => t.visibility === "public"),
      mine: visible.filter((t) => t.ownerTeamId === teamId),
      isPlatformOwner,
      queue: isPlatformOwner ? visible.filter((t) => t.visibility === "public-pending") : [],
      teamId,
      async getTemplate(id) {
        const t = store.list.find((x) => x.id === id);
        return t && (t.visibility === "public" || t.ownerTeamId === teamId) ? t : null;
      },
      async create(input) {
        const content = build(input);
        const id = `mem${++store.counter}`;
        const now = Date.now();
        commit((l) => [...l, { ...content, id, ownerTeamId: teamId, authorName, visibility: "private", official: false, version: 1, importCount: 0, reportCount: 0, createdAt: now, updatedAt: now }]);
        onAudit?.("save-form-template", { id });
        return id;
      },
      async update(id, input) {
        const t = mineOnly(id);
        if (t.visibility !== "private" && t.visibility !== "rejected") throw new Error("Unpublish it first.");
        const content = build(input);
        patch(id, { ...content, version: t.version + (content.checksum !== t.checksum ? 1 : 0), visibility: "private", updatedAt: Date.now() });
        unset(id, "rejectionReason");
        onAudit?.("update-form-template", { id });
      },
      async remove(id) {
        const t = mineOnly(id);
        if (t.visibility !== "private" && t.visibility !== "rejected") throw new Error("Unpublish it first.");
        commit((l) => l.filter((x) => x.id !== id));
        onAudit?.("delete-form-template", { id });
      },
      async requestPublish(id) {
        const t = mineOnly(id);
        if (t.visibility !== "private" && t.visibility !== "rejected") throw new Error("It's already public or waiting for review.");
        if (!checksumMatches(t)) throw new Error("This template's checksum doesn't match its contents.");
        const waiting = store.list.filter((x) => x.ownerTeamId === teamId && (x.visibility === "public-pending" || x.hasPendingUpdate)).length;
        if (waiting >= TEMPLATE_LIMITS.pendingPerAccount) throw new Error("Your account already has 5 templates waiting for review.");
        patch(id, { visibility: "public-pending", requestedAt: Date.now() });
        unset(id, "rejectionReason");
        onAudit?.("request-template-publish", { id });
      },
      async sendUpdate(id, input) {
        const t = mineOnly(id);
        if (t.visibility !== "public") throw new Error("Only a public template is updated this way.");
        const content = build(input);
        if (content.checksum === t.checksum && content.name === t.name && content.description === t.description && content.tags.join() === t.tags.join()) throw new Error("That's the same as the version that's already public.");
        store.pending.set(id, { ...content, version: t.version + 1 });
        patch(id, { hasPendingUpdate: true });
        onAudit?.("request-template-publish", { id, update: true });
      },
      async unpublish(id) {
        const t = mineOnly(id);
        if (t.visibility !== "public" && t.visibility !== "public-pending") throw new Error("It isn't public or waiting for review.");
        store.pending.delete(id);
        patch(id, { visibility: "private" });
        unset(id, "hasPendingUpdate");
        onAudit?.("unpublish-template", { id });
      },
      async report(id, why) {
        const t = find(id);
        if (t.visibility !== "public") throw new Error("Only public templates can be reported.");
        if (t.ownerTeamId === teamId) throw new Error("That's your own template.");
        const clean = reason(why);
        const list = store.reports.get(id) ?? [];
        if (list.some((r) => r.teamId === teamId)) throw new Error("Your account has already reported this template.");
        store.reports.set(id, [...list, { teamId, reason: clean, at: Date.now() }]);
        patch(id, { reportCount: t.reportCount + 1 });
      },
      async use(id) {
        const t = find(id);
        if (t.visibility !== "public" && t.ownerTeamId !== teamId) throw new Error("That template isn't available to you.");
        if (t.visibility === "public" && t.ownerTeamId !== teamId && !store.used.has(`${id}:${teamId}`)) {
          store.used.add(`${id}:${teamId}`);
          patch(id, { importCount: t.importCount + 1 });
        }
        onAudit?.("use-form-template", { id });
        return find(id);
      },
      async getPendingUpdate(id) {
        platform();
        return store.pending.get(id) ?? null;
      },
      async getReports(id) {
        platform();
        return store.reports.get(id) ?? [];
      },
      async approve(id) {
        platform();
        const t = find(id);
        const p = store.pending.get(id);
        if (t.hasPendingUpdate && p) {
          patch(id, { ...p, publishedAt: Date.now(), updatedAt: Date.now() });
          unset(id, "hasPendingUpdate");
          store.pending.delete(id);
        } else if (t.visibility === "public-pending") {
          patch(id, { visibility: "public", publishedAt: Date.now(), updatedAt: Date.now() });
        } else throw new Error("Nothing to approve.");
        onAudit?.("approve-template", { id });
      },
      async reject(id, why) {
        platform();
        const t = find(id);
        const clean = reason(why);
        if (t.hasPendingUpdate) {
          store.pending.delete(id);
          unset(id, "hasPendingUpdate");
        } else if (t.visibility === "public-pending") patch(id, { visibility: "rejected", rejectionReason: clean });
        else throw new Error("Nothing to reject.");
        onAudit?.("reject-template", { id, reason: clean });
      },
      async takeDown(id, why) {
        platform();
        const t = find(id);
        if (t.visibility !== "public") throw new Error("Only a public template can be taken down.");
        patch(id, { visibility: "rejected", rejectionReason: reason(why), official: false });
        unset(id, "hasPendingUpdate");
        store.pending.delete(id);
        onAudit?.("takedown-template", { id });
      },
      async setOfficial(id, official) {
        platform();
        if (find(id).visibility !== "public") throw new Error("Only a public template can be official.");
        patch(id, { official });
      },
      async dismissReports(id) {
        platform();
        store.reports.delete(id);
        patch(id, { reportCount: 0 });
      },
      async seedOfficial() {
        platform();
        const results: { id: string; result: string }[] = [];
        for (const o of officialTemplates()) {
          const existing = store.list.find((t) => t.id === o.id);
          if (!existing) {
            commit((l) => [...l, { ...o.content, id: o.id, ownerTeamId: teamId, authorName: OFFICIAL_AUTHOR, visibility: "public", official: true, version: 1, importCount: 0, reportCount: 0, createdAt: 1, updatedAt: 1, publishedAt: 1 }]);
            results.push({ id: o.id, result: "created" });
          } else if (existing.checksum !== o.content.checksum) {
            patch(o.id, { ...o.content, version: existing.version + 1 });
            results.push({ id: o.id, result: "updated" });
          } else results.push({ id: o.id, result: "unchanged" });
        }
        onAudit?.("seed-official-templates", { results });
        return results;
      },
    };
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getService() {
      if (!cached) cached = buildService();
      return cached;
    },
  };
}

export function useMemoryTemplates(m: MemoryTemplates): TemplateService {
  return useSyncExternalStore(m.subscribe, m.getService, m.getService);
}

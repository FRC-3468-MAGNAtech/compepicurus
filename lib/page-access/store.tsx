"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import {
  canAccessPage,
  defaultPageAccessConfig,
  grantMemberPage,
  pageRolesOf,
  parsePageAccess,
  samePageAccess,
  type AccessUser,
  type PageAccessConfig,
} from "@/lib/page-access/access";
import { getPage } from "@/lib/page-access/pages";

// P26: the page-access doc `teams/{teamId}/settings/pageAccess` (realtime, one subscription shared by the nav, the route
// guard and the Admin Panel) and the access requests `teams/{teamId}/pageAccessRequests/{uid}_{pageId}`.

const settingsRef = (teamId: string) => doc(db, "teams", teamId, "settings", "pageAccess");
const requestsRef = (teamId: string) => collection(db, "teams", teamId, "pageAccessRequests");
export const requestDocId = (uid: string, pageId: string) => `${uid}_${pageId}`;

/** The stored shape (what the rules read): the config plus the `pageRoles` mirror, who wrote it and when. */
export function pageAccessDocData(config: PageAccessConfig, uid: string) {
  return { roleGrants: config.roleGrants, pageRoles: pageRolesOf(config), memberOverrides: config.memberOverrides, updatedBy: uid, updatedAt: serverTimestamp() };
}

/** A short, audit-friendly description of what a config grants beyond the defaults (the log shows this, not the whole doc). */
function summarize(config: PageAccessConfig) {
  return { roleGrants: config.roleGrants, memberOverrides: config.memberOverrides };
}

type Actor = { teamId: string; uid: string; name: string };

/**
 * Applies one edit to the stored config **inside a transaction** (read the latest doc, apply, write it back with an
 * `edit-page-access` audit entry), so two admins editing different cells at once compose instead of one overwriting the
 * other. `change` says what was changed, for the log. Returns false (writing nothing) when the edit changes nothing.
 */
export async function updatePageAccess(actor: Actor, apply: (config: PageAccessConfig) => PageAccessConfig, change: Record<string, unknown>): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef(actor.teamId));
    const before = parsePageAccess(snap.exists() ? snap.data() : undefined);
    const after = apply(before);
    if (samePageAccess(before, after)) return false;
    tx.set(settingsRef(actor.teamId), pageAccessDocData(after, actor.uid));
    tx.set(newAuditLogRef(), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-page-access", change, summarize(before), summarize(after)));
    return true;
  });
}

/** Creates the doc from the defaults if (and only if) it doesn't exist: the idempotent migration. */
export async function ensurePageAccessDoc(teamId: string, uid: string): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef(teamId));
    if (snap.exists()) return false;
    tx.set(settingsRef(teamId), pageAccessDocData(defaultPageAccessConfig(), uid));
    return true;
  });
}

export type PageAccessRequest = {
  id: string;
  uid: string;
  name: string;
  pageId: string;
  pageTitle: string;
  status: "pending" | "approved" | "denied";
  createdAtMs: number;
};

const toMs = (v: unknown): number => (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function" ? (v as { toMillis: () => number }).toMillis() : 0);

/** A member asks for a page they can't open. One request per person and page (re-asking after a denial replaces it). */
export async function requestPageAccess(actor: Actor, pageId: string): Promise<void> {
  const page = getPage(pageId);
  if (!page || page.access !== "restricted") throw new Error("That page can't be requested.");
  await setDoc(doc(requestsRef(actor.teamId), requestDocId(actor.uid, pageId)), {
    teamId: actor.teamId,
    uid: actor.uid,
    name: actor.name,
    pageId,
    pageTitle: page.title,
    status: "pending",
    createdAt: serverTimestamp(),
  });
}

/**
 * An admin decides a request, in a transaction: approving adds the page as a grant for that member to the *latest* config
 * and marks the request; denying only marks the request. One audit entry either way. A request someone else already
 * decided is left alone (returns false).
 */
export async function decidePageAccessRequest(actor: Actor, request: PageAccessRequest, approve: boolean): Promise<boolean> {
  const requestRef = doc(requestsRef(actor.teamId), request.id);
  return runTransaction(db, async (tx) => {
    const [requestSnap, settingsSnap] = await Promise.all([tx.get(requestRef), tx.get(settingsRef(actor.teamId))]);
    if (!requestSnap.exists() || requestSnap.data().status !== "pending") return false;
    tx.update(requestRef, { status: approve ? "approved" : "denied", decidedBy: actor.uid, decidedAt: serverTimestamp() });
    if (approve) {
      const before = parsePageAccess(settingsSnap.exists() ? settingsSnap.data() : undefined);
      tx.set(settingsRef(actor.teamId), pageAccessDocData(grantMemberPage(before, request.uid, request.pageId), actor.uid));
    }
    tx.set(
      newAuditLogRef(),
      buildAuditEntry(actor.teamId, actor.uid, actor.name, "decide-page-access-request", { targetUid: request.uid, targetName: request.name, pageId: request.pageId, decision: approve ? "approved" : "denied" }, null, null)
    );
    return true;
  });
}

// --- the shared subscription ----------------------------------------------------------------------------------------------

type PageAccessValue = {
  config: PageAccessConfig;
  /** The doc (or its absence, meaning the defaults) has been read. */
  loaded: boolean;
  /** `canAccessPage` for the signed-in person. False until signed in. */
  can: (pageId: string) => boolean;
};

const DEFAULT_VALUE: PageAccessValue = { config: defaultPageAccessConfig(), loaded: true, can: () => false };

const PageAccessContext = createContext<PageAccessValue | null>(null);

/** The signed-in person as access sees them. */
export function useAccessUser(): AccessUser | null {
  const { user, profile } = useAuth();
  return useMemo(
    () => (user && profile ? { uid: user.uid, isAdmin: profile.isAdmin, isOwner: profile.isOwner, primaryRole: profile.primaryRole, secondaryRoles: profile.secondaryRoles ?? [] } : null),
    [user, profile]
  );
}

// Per page load, so the dozens of components that read this don't each try to create the doc; and an admin's session only.
const migrationsAttempted = new Set<string>();

export function PageAccessProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const accessUser = useAccessUser();
  const [state, setState] = useState<{ teamId: string; config: PageAccessConfig; exists: boolean } | null>(null);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) return;
    return onSnapshot(
      settingsRef(teamId),
      (snap) => setState({ teamId, config: parsePageAccess(snap.exists() ? snap.data() : undefined), exists: snap.exists() }),
      (err) => {
        // Not readable (rules not deployed yet, or offline with nothing cached): fall back to the defaults rather than lock people out of the app.
        reportFirestoreError("page access subscription failed", err, `teams/${teamId}/settings/pageAccess`);
        setState({ teamId, config: defaultPageAccessConfig(), exists: false });
      }
    );
  }, [teamId]);

  const current = state && state.teamId === teamId ? state : null;

  // The migration: the first admin session to find no doc writes the defaults (idempotent, in a transaction).
  const isAdmin = profile?.isAdmin ?? false;
  const uid = accessUser?.uid ?? null;
  useEffect(() => {
    if (!teamId || !uid || !isAdmin || !current || current.exists || migrationsAttempted.has(teamId)) return;
    migrationsAttempted.add(teamId);
    ensurePageAccessDoc(teamId, uid).catch((err) => {
      migrationsAttempted.delete(teamId);
      console.error("page access migration failed:", err);
    });
  }, [teamId, uid, isAdmin, current]);

  const config = current?.config ?? DEFAULT_VALUE.config;
  const can = useCallback((pageId: string) => canAccessPage(accessUser, pageId, config), [accessUser, config]);
  const value = useMemo<PageAccessValue>(() => ({ config, loaded: current !== null || !teamId || !isFirebaseConfigured(), can }), [config, current, teamId, can]);

  return <PageAccessContext.Provider value={value}>{children}</PageAccessContext.Provider>;
}

/** The shared page-access state. Outside the provider (a test fixture) it answers from the defaults for the signed-in person. */
export function usePageAccess(): PageAccessValue {
  const ctx = useContext(PageAccessContext);
  const accessUser = useAccessUser();
  const fallback = useMemo<PageAccessValue>(() => ({ config: DEFAULT_VALUE.config, loaded: true, can: (id) => canAccessPage(accessUser, id, DEFAULT_VALUE.config) }), [accessUser]);
  return ctx ?? fallback;
}

/** Requests, live. An admin passes `all` and gets every request of the team; anyone else gets their own. */
export function usePageAccessRequests(teamId: string | null, opts: { all: boolean; uid: string | null }): { requests: PageAccessRequest[]; loaded: boolean } {
  const [held, setHeld] = useState<{ key: string; requests: PageAccessRequest[] } | null>(null);
  const key = teamId && (opts.all || opts.uid) ? `${teamId}|${opts.all ? "all" : opts.uid}` : null;

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured() || (!opts.all && !opts.uid)) return;
    const k = `${teamId}|${opts.all ? "all" : opts.uid}`;
    const q = opts.all ? query(requestsRef(teamId)) : query(requestsRef(teamId), where("uid", "==", opts.uid));
    return onSnapshot(
      q,
      (snap) =>
        setHeld({
          key: k,
          requests: snap.docs
            .map((d) => {
              const r = d.data();
              return { id: d.id, uid: String(r.uid ?? ""), name: String(r.name ?? ""), pageId: String(r.pageId ?? ""), pageTitle: String(r.pageTitle ?? r.pageId ?? ""), status: r.status === "approved" || r.status === "denied" ? r.status : "pending", createdAtMs: toMs(r.createdAt) } satisfies PageAccessRequest;
            })
            .sort((a, b) => b.createdAtMs - a.createdAtMs),
        }),
      (err) => {
        reportFirestoreError("page access requests subscription failed", err, `teams/${teamId}/pageAccessRequests`);
        setHeld({ key: k, requests: [] });
      }
    );
  }, [teamId, opts.all, opts.uid]);

  if (!key) return { requests: [], loaded: true };
  return held?.key === key ? { requests: held.requests, loaded: true } : { requests: [], loaded: false };
}

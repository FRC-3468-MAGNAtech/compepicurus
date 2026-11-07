"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where, type DocumentData } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { authedApi } from "@/lib/api-client";
import { effectiveStatus, type ApplicationSignals, type ApplicationStatus } from "@/lib/applications";
import type { RoleId } from "@/lib/roles";

/** A `teamApplications` doc as the app reads it (timestamps as milliseconds). */
export type TeamApplication = {
  id: string;
  applicantUid: string;
  applicantName: string;
  applicantEmail: string;
  teamNumber: number;
  teamName: string;
  officialTeamName: string | null;
  role: RoleId;
  verification: string;
  link: string | null;
  /** As stored. Use `effectiveStatus(app)` for what to show: a pending application past its expiry is expired. */
  status: ApplicationStatus;
  rejectionReason: string | null;
  createdAtMs: number | null;
  expiresAtMs: number | null;
  decidedAtMs: number | null;
  teamId: string | null;
};

export type ApplicationBlock = { id: string; type: "email" | "team"; value: string; reason: string | null; createdAtMs: number | null };

const ms = (v: unknown): number | null => (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function" ? (v as { toMillis: () => number }).toMillis() : null);

function toApplication(id: string, d: DocumentData): TeamApplication {
  return {
    id,
    applicantUid: d.applicantUid,
    applicantName: d.applicantName ?? "",
    applicantEmail: d.applicantEmail ?? "",
    teamNumber: d.teamNumber,
    teamName: d.teamName ?? "",
    officialTeamName: d.officialTeamName ?? null,
    role: d.role,
    verification: d.verification ?? "",
    link: d.link ?? null,
    status: d.status,
    rejectionReason: d.rejectionReason ?? null,
    createdAtMs: ms(d.createdAt),
    expiresAtMs: ms(d.expiresAt),
    decidedAtMs: ms(d.decidedAt),
    teamId: d.teamId ?? null,
  };
}

/** What to show for an application right now (expiry is lazy: a pending one past its date is `expired`). */
export function statusOf(app: TeamApplication, nowMs: number = Date.now()): ApplicationStatus {
  return effectiveStatus({ status: app.status, expiresAtMs: app.expiresAtMs }, nowMs);
}

/** The signed-in applicant's own applications, newest first (rules: an applicant reads only their own). */
export function useMyApplications(uid: string | null) {
  const [apps, setApps] = useState<TeamApplication[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  useEffect(() => {
    if (!uid || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApps([]);
      setLoaded(true);
      return;
    }
    return onSnapshot(
      query(collection(db, "teamApplications"), where("applicantUid", "==", uid)),
      (snap) => {
        setApps(snap.docs.map((d) => toApplication(d.id, d.data())).sort((a, b) => (b.createdAtMs ?? Number.MAX_SAFE_INTEGER) - (a.createdAtMs ?? Number.MAX_SAFE_INTEGER)));
        setLoaded(true);
      },
      (err) => {
        console.error("teamApplications (own) subscription failed:", err);
        setApps([]);
        setLoaded(true);
      }
    );
  }, [uid]);
  return { applications: apps, loaded };
}

/** Every application, newest first. Platform owners only (rules); pass `enabled: false` for everyone else so nothing is subscribed. */
export function useAllApplications(enabled: boolean) {
  const [apps, setApps] = useState<TeamApplication[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApps([]);
      setLoaded(true);
      return;
    }
    return onSnapshot(
      collection(db, "teamApplications"),
      (snap) => {
        setApps(snap.docs.map((d) => toApplication(d.id, d.data())).sort((a, b) => (b.createdAtMs ?? Number.MAX_SAFE_INTEGER) - (a.createdAtMs ?? Number.MAX_SAFE_INTEGER)));
        setLoaded(true);
      },
      (err) => {
        console.error("teamApplications subscription failed:", err);
        setApps([]);
        setLoaded(true);
      }
    );
  }, [enabled]);
  return { applications: apps, loaded };
}

/** How many applications are waiting (pending and not expired): the badge on the Admin Panel. Platform owners only. */
export function usePendingApplicationCount(enabled: boolean): number {
  const [apps, setApps] = useState<{ expiresAtMs: number | null }[]>([]);
  useEffect(() => {
    if (!enabled || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApps([]);
      return;
    }
    return onSnapshot(
      query(collection(db, "teamApplications"), where("status", "==", "pending")),
      (snap) => setApps(snap.docs.map((d) => ({ expiresAtMs: ms(d.data().expiresAt) }))),
      () => setApps([])
    );
  }, [enabled]);
  // The wall clock is read once per snapshot: expiry only matters to the minute, and nothing re-renders just for it.
  const [now] = useState(() => Date.now());
  return useMemo(() => apps.filter((a) => effectiveStatus({ status: "pending", expiresAtMs: a.expiresAtMs }, now) === "pending").length, [apps, now]);
}

export type ApplicationPrivate = { signals: ApplicationSignals | null; notes: string };

/** The reviewer-only side of one application (signals, notes). Subscribes only while `id` is set (when a row is expanded). */
export function useApplicationPrivate(id: string | null) {
  const [data, setData] = useState<ApplicationPrivate | null>(null);
  useEffect(() => {
    if (!id || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null);
      return;
    }
    return onSnapshot(
      doc(db, "applicationPrivate", id),
      (snap) => setData(snap.exists() ? { signals: (snap.data().signals as ApplicationSignals) ?? null, notes: String(snap.data().notes ?? "") } : { signals: null, notes: "" }),
      () => setData({ signals: null, notes: "" })
    );
  }, [id]);
  return data;
}

export function useApplicationBlocks(enabled: boolean) {
  const [blocks, setBlocks] = useState<ApplicationBlock[]>([]);
  useEffect(() => {
    if (!enabled || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBlocks([]);
      return;
    }
    return onSnapshot(
      collection(db, "applicationBlocks"),
      (snap) => setBlocks(snap.docs.map((d) => ({ id: d.id, type: d.data().type, value: String(d.data().value ?? ""), reason: d.data().reason ?? null, createdAtMs: ms(d.data().createdAt) }))),
      () => setBlocks([])
    );
  }, [enabled]);
  return blocks;
}

// --- calls -----------------------------------------------------------------------------------

export async function fetchStartToken(): Promise<string> {
  const res = await fetch("/api/applications/start", { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || typeof json.token !== "string") throw new Error("Couldn't start the application form. Refresh and try again.");
  return json.token;
}

export type ApplicationSubmission = {
  name: string;
  teamNumber: string;
  teamName: string;
  role: string;
  verification: string;
  link: string;
  startToken: string;
  turnstileToken: string | null;
  /** The honeypot: always empty from the real form. */
  orgUrl: string;
};

export function submitApplication(body: ApplicationSubmission): Promise<{ applicationId: string }> {
  return authedApi("/api/applications", { method: "POST", body });
}

export function decideApplication(
  payload:
    | { action: "approve"; applicationId: string }
    | { action: "reject"; applicationId: string; reason: string }
    | { action: "block"; applicationId: string; blockEmail: boolean; blockTeam: boolean; reason: string }
    | { action: "unblock"; blockId: string }
    | { action: "note"; applicationId: string; notes: string }
): Promise<{ teamId?: string }> {
  return authedApi("/api/admin/applications", { method: "POST", body: payload });
}

export type ApplicationConfig = { turnstileSecretConfigured: boolean; turnstileSiteKeyConfigured: boolean; emailConfigured: boolean };

export function fetchApplicationConfig(): Promise<ApplicationConfig> {
  return authedApi<ApplicationConfig>("/api/admin/application-config");
}

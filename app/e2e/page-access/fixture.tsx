"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NoAccessScreen, type RequestStatus } from "@/components/page-access/no-access-screen";
import { PageAccessPanelView } from "@/components/page-access/page-access-panel";
import { defaultPageAccessConfig, grantMemberPage, setMemberPageState, setRoleGrant, type PageAccessConfig } from "@/lib/page-access/access";
import type { PageAccessRequest } from "@/lib/page-access/store";
import type { TeamMember } from "@/lib/team-members";

declare global {
  interface Window {
    /** What the screens asked to save, in order (for the tests). */
    __pa?: { type: string; [key: string]: unknown }[];
  }
}

const member = (uid: string, name: string, primaryRole: TeamMember["primaryRole"], extra: Partial<TeamMember> = {}): TeamMember => ({ uid, name, email: `${uid}@example.com`, primaryRole, secondaryRoles: [], isAdmin: false, isOwner: false, ...extra });

const MEMBERS: TeamMember[] = [
  member("root", "Root Owner", "lead-scout", { isAdmin: true, isOwner: true }),
  member("ada", "Ada Admin", "team-coach", { isAdmin: true }),
  member("lee", "Lee Lead", "lead-scout"),
  member("mia", "Mia Media", "media"),
  member("sam", "Sam Scout", "match-scout", { secondaryRoles: ["pit-team"] }),
];

const REQUESTS: PageAccessRequest[] = [
  { id: "mia_assignments", uid: "mia", name: "Mia Media", pageId: "assignments", pageTitle: "Assignments", status: "pending", createdAtMs: 2 },
  { id: "sam_team-management", uid: "sam", name: "Sam Scout", pageId: "team-management", pageTitle: "Team Management", status: "pending", createdAtMs: 1 },
];

const log = (entry: { type: string; [key: string]: unknown }) => (window.__pa ??= []).push(entry);

function PanelFixture({ tab, memberUid, noRequests }: { tab: "requests" | "roles" | "members"; memberUid?: string; noRequests: boolean }) {
  const [config, setConfig] = useState<PageAccessConfig>(() => defaultPageAccessConfig());
  const [requests, setRequests] = useState<PageAccessRequest[]>(noRequests ? [] : REQUESTS);
  return (
    <PageAccessPanelView
      key={tab}
      config={config}
      members={MEMBERS}
      requests={requests}
      initialTab={tab}
      initialMemberUid={memberUid}
      onToggleRole={(role, pageId, on) => {
        log({ type: "role", role, pageId, on });
        setConfig((c) => setRoleGrant(c, role, pageId, on));
      }}
      onSetMemberPage={(m, pageId, state) => {
        log({ type: "member", uid: m.uid, pageId, state });
        setConfig((c) => setMemberPageState(c, m.uid, pageId, state));
      }}
      onDecide={(request, approve) => {
        log({ type: "decide", id: request.id, approve });
        setRequests((rs) => rs.map((r) => (r.id === request.id ? { ...r, status: approve ? "approved" : "denied" } : r)));
        if (approve) setConfig((c) => grantMemberPage(c, request.uid, request.pageId));
      }}
    />
  );
}

function NoAccessFixture({ status, adminOnly, fail }: { status: RequestStatus; adminOnly: boolean; fail: boolean }) {
  const [current, setCurrent] = useState<RequestStatus>(status);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <NoAccessScreen
      pageTitle={adminOnly ? "the Admin Panel" : "Assignments"}
      adminOnly={adminOnly}
      status={current}
      sending={sending}
      error={error}
      onRequest={() => {
        setSending(true);
        setError(null);
        setTimeout(() => {
          setSending(false);
          if (fail) {
            setError("Couldn't send that request. Check your connection and try again.");
            return;
          }
          log({ type: "request", pageId: "assignments" });
          setCurrent("pending");
        }, 150);
      }}
    />
  );
}

function Fixture() {
  const q = useSearchParams();
  const view = q.get("view") ?? "panel";
  useEffect(() => {
    window.__pa = [];
  }, []);
  return (
    <div className="p-4">
      {view === "no-access" ? (
        <NoAccessFixture status={(q.get("status") as RequestStatus) ?? "none"} adminOnly={q.get("admin-only") === "1"} fail={q.get("fail") === "1"} />
      ) : (
        <PanelFixture tab={(q.get("tab") as "requests" | "roles" | "members") ?? "roles"} memberUid={q.get("member") ?? undefined} noRequests={q.get("requests") === "none"} />
      )}
    </div>
  );
}

export function PageAccessFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}

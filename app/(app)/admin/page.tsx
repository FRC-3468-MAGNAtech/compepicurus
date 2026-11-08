"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/lib/permissions";
import { fetchTeamCreationEnabled, setTeamCreationEnabled } from "@/lib/team-enrollment";
import { MatchLibraryPanel } from "@/components/admin/match-library-panel";
import { SessionsPanel } from "@/components/admin/sessions-panel";
import { RescorePanel } from "@/components/admin/rescore-panel";
import { AuditLogPanel } from "@/components/admin/audit-log-panel";
import { BackupsPanel } from "@/components/admin/backups-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApplicationsPanel } from "@/components/admin/applications-panel";
import { RecoveryPanel } from "@/components/admin/recovery-panel";
import { FormsPanel } from "@/components/forms/forms-panel";
import { PageAccessPanel } from "@/components/page-access/page-access-panel";
import { ReviewPanelHost } from "@/components/templates/review-panel";
import { usePendingApplicationCount } from "@/lib/applications-client";

type AdminTab = "match-library" | "forms" | "page-access" | "sessions" | "rescore" | "audit-log" | "backups" | "applications" | "templates" | "recovery";

const TAB_LABELS: Record<AdminTab, string> = {
  "match-library": "Match Library",
  // P22: the Form Builder (owner and admin)
  forms: "Forms",
  // P26: who can open which page (admins only: this whole panel is admin-only)
  "page-access": "Page Access",
  sessions: "Sessions",
  rescore: "Rescore",
  "audit-log": "Audit Log",
  backups: "Backups",
  // P20: platform owners only
  applications: "Team Applications",
  templates: "Template Review",
  recovery: "Recovery",
};

const PLATFORM_TABS: AdminTab[] = ["applications", "templates", "recovery"];

export default function AdminPanelPage() {
  const router = useRouter();
  const { isAdmin, isPlatformOwner, can } = usePermissions();
  const pendingApplications = usePendingApplicationCount(isPlatformOwner);
  const [teamCreationEnabled, setTeamCreationEnabledState] = useState<boolean | null>(null);
  const [togglingTeamCreation, setTogglingTeamCreation] = useState(false);
  const [teamCreationError, setTeamCreationError] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("match-library");

  useEffect(() => {
    if (!isAdmin) router.replace("/dashboard");
  }, [isAdmin, router]);

  useEffect(() => {
    if (!isPlatformOwner) return;
    fetchTeamCreationEnabled().then(setTeamCreationEnabledState);
  }, [isPlatformOwner]);

  const handleToggleTeamCreation = async (checked: boolean) => {
    setTeamCreationError(null);
    setTogglingTeamCreation(true);
    const previous = teamCreationEnabled;
    setTeamCreationEnabledState(checked);
    try {
      await setTeamCreationEnabled(checked);
    } catch (err) {
      setTeamCreationEnabledState(previous);
      setTeamCreationError(err instanceof Error ? err.message : "Couldn't change this.");
    } finally {
      setTogglingTeamCreation(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="flex flex-col gap-6">
      <GlassPanel
        strong
        className="flex items-center gap-3 border-red-400/30"
        style={{ boxShadow: "0 0 0 1px rgba(239,68,68,0.25), 0 12px 32px -12px rgba(239,68,68,0.35)" }}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/15">
          <ShieldAlert className="h-5 w-5 text-red-300" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Admin Panel</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Elevated controls &mdash; changes here affect the whole team.</p>
        </div>
        <Badge variant="danger" className="ml-auto">Privileged area</Badge>
      </GlassPanel>

      {isPlatformOwner && (
        <GlassPanel className="flex flex-col gap-4 border-amber-400/20">
          <h2 className="text-base font-semibold">Platform owner settings</h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Allow team creation</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                Lets the Signup / Finish Setup page offer &ldquo;Create a team&rdquo; directly. Off by default once a team exists: other teams apply instead, and you approve them under Team Applications.
              </div>
            </div>
            <Switch
              checked={teamCreationEnabled ?? false}
              onCheckedChange={handleToggleTeamCreation}
              disabled={teamCreationEnabled === null || togglingTeamCreation}
            />
          </div>
          {teamCreationError && <p className="text-sm text-red-400">{teamCreationError}</p>}
        </GlassPanel>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTab)}>
        <TabsList>
          {(Object.keys(TAB_LABELS) as AdminTab[])
            .filter((t) => isPlatformOwner || !PLATFORM_TABS.includes(t))
            .filter((t) => t !== "forms" || can("manageForms"))
            .map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
                {t === "applications" && pendingApplications > 0 && (
                  <span className="ml-2 rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary-foreground)]" aria-label={`${pendingApplications} waiting`}>
                    {pendingApplications}
                  </span>
                )}
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>

      {tab === "match-library" && <MatchLibraryPanel onOpenRescore={() => setTab("rescore")} />}
      {tab === "forms" && can("manageForms") && <FormsPanel onOpenRescore={() => setTab("rescore")} />}
      {tab === "page-access" && <PageAccessPanel />}
      {tab === "sessions" && <SessionsPanel />}
      {tab === "rescore" && <RescorePanel />}
      {tab === "audit-log" && <AuditLogPanel />}
      {tab === "backups" && <BackupsPanel />}
      {tab === "applications" && isPlatformOwner && <ApplicationsPanel />}
      {tab === "templates" && isPlatformOwner && <ReviewPanelHost />}
      {tab === "recovery" && isPlatformOwner && <RecoveryPanel />}
    </div>
  );
}

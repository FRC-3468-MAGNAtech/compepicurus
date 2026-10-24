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

export default function AdminPanelPage() {
  const router = useRouter();
  const { isAdmin, isOwner } = usePermissions();
  const [teamCreationEnabled, setTeamCreationEnabledState] = useState<boolean | null>(null);
  const [togglingTeamCreation, setTogglingTeamCreation] = useState(false);
  const [teamCreationError, setTeamCreationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) router.replace("/dashboard");
  }, [isAdmin, router]);

  useEffect(() => {
    if (!isOwner) return;
    fetchTeamCreationEnabled().then(setTeamCreationEnabledState);
  }, [isOwner]);

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

      {isOwner && (
        <GlassPanel className="flex flex-col gap-4 border-amber-400/20">
          <h2 className="text-base font-semibold">Owner settings</h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Allow team creation</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                Lets the Signup / Finish Setup page offer &ldquo;Create a team&rdquo; again. Off by default once a team exists.
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

      <MatchLibraryPanel />
    </div>
  );
}

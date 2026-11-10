"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { PlaceholderBanner } from "@/components/ui/placeholder-banner";
import { VerifyEmailBanner } from "@/components/layout/verify-email-banner";
import { LibraryBackfill } from "@/components/admin/library-backfill";
import { SiteFooter } from "@/components/layout/site-footer";
import { LiveMatchPill } from "@/components/layout/live-match-pill";
import { ScoresReadyWatcher } from "@/components/layout/scores-ready-watcher";
import { TeamAssignmentsWatcher } from "@/components/layout/team-assignments-watcher";
import { useAuth } from "@/lib/auth";
import { useConnectionNotice } from "@/lib/use-connection-state";
import { FieldTeamsProvider } from "@/lib/field-teams-context";
import { PageGuard } from "@/components/page-access/page-guard";
import { PageAccessProvider } from "@/lib/page-access/store";
import { FormsProvider } from "@/lib/forms/forms-context";
import { OwnershipTransferBanner } from "@/components/layout/ownership-transfer-banner";
import { ImmersiveContext, useImmersiveValue } from "@/lib/shell-immersive";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // P24: the practice workspace's Focus mode hides the sidebar and the mobile top bar (lib/shell-immersive.tsx).
  const [immersive, setImmersive] = useState(false);
  const immersiveValue = useImmersiveValue(immersive, setImmersive);
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  // One subscription for the offline / unsynced badge, shared by the sidebar and the mobile top bar.
  const connection = useConnectionNotice();
  // Pages wired to real data (Firestore/FIRST API) as of P1-P3 — everything
  // else here still runs on lib/mock-data.ts. Update this list as more
  // pages stop being placeholders.
  const REALIZED_PAGES = [
    "/event",
    "/scout",
    "/analytics/match-scout",
    "/analytics/team-averages",
    "/analytics/rankings",
    "/analytics/match-breakdown",
    "/analytics/team-breakdown",
    "/analytics/pick-list",
    "/analytics/scout-status",
    "/dashboard",
    "/match-list",
    "/lead-scout-form",
    "/match-strategy-form",
    "/drive-reflection-form",
    "/pit-scout-form",
    "/team-strategy-form",
    "/helper-form",
    "/analytics/teams",
    "/people",
    "/profile",
    "/team-management",
    "/team-settings",
    "/account",
    "/admin",
    "/practice-scouting",
    "/scout-accuracy",
    "/my-scouting",
    "/assignments",
    "/changelog",
    "/credits",
  ];
  const isPlaceholderPage = !REALIZED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    // Signed in but no user doc yet (first-time Google sign-in, or anyone
    // who closed the tab before finishing — see docs/ASSUMPTIONS.md, P1b).
    else if (!profile) router.replace("/finish-setup");
  }, [loading, user, profile, router]);

  if (loading || !user || !profile) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="glass-card h-10 w-10 animate-pulse rounded-full" />
      </div>
    );
  }

  return (
    // P19: one shared subscription to the account's FTC teams for the whole signed-in app.
    <FieldTeamsProvider>
      {/* P26: one shared subscription to the account's page access, for the nav, the route guard and the permissions. */}
      <PageAccessProvider>
      <FormsProvider>
      <ImmersiveContext.Provider value={immersiveValue}>
      <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 pb-6 pt-4 lg:px-6">
        {!immersive && <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} connection={connection} />}
        <div className="min-w-0 flex-1">
          {!immersive && <Topbar onMenuClick={() => setMobileNavOpen(true)} connection={connection} />}
          <main className="min-w-0">
            <VerifyEmailBanner className="mb-4" />
            <OwnershipTransferBanner className="mb-4" />
            {isPlaceholderPage && <PlaceholderBanner className="mb-4" />}
            <LiveMatchPill />
            <PageTransition>
              <PageGuard>{children}</PageGuard>
            </PageTransition>
          </main>
          <SiteFooter className="mt-10" />
        </div>
        <ScoresReadyWatcher />
        <TeamAssignmentsWatcher />
        {profile.isAdmin && <LibraryBackfill />}
      </div>
      </ImmersiveContext.Provider>
      </FormsProvider>
      </PageAccessProvider>
    </FieldTeamsProvider>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { AdminStrip } from "@/components/dashboard/admin-strip";
import { HeaderStrip } from "@/components/dashboard/header-strip";
import { dashboardRegistry } from "@/components/dashboard/registry";
import { RoleSwitcher } from "@/components/dashboard/role-switcher";
import { WIDGET_GRID_CLASS, WidgetBoundary } from "@/components/dashboard/widget";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { useAuth } from "@/lib/auth";
import { DashboardProvider, useDashboard } from "@/lib/dashboard/data";
import { useSavedDashboardRole } from "@/lib/dashboard/prefs";
import { resolveViewRole, userRoles } from "@/lib/dashboard/roles";
import { getRole, type RoleId } from "@/lib/roles";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [saved, saveRole] = useSavedDashboardRole(user?.uid ?? null);
  // An admin's "View as role" preview — never saved, and gone on reload.
  const [viewAs, setViewAs] = useState<RoleId | null>(null);

  if (!profile) return null; // the app shell only renders pages once the profile exists

  const isAdmin = profile.isAdmin;
  const roles = userRoles(profile.primaryRole, profile.secondaryRoles);
  const role = resolveViewRole({ primaryRole: profile.primaryRole, secondaryRoles: profile.secondaryRoles, saved, viewAs: isAdmin ? viewAs : null });

  return (
    // The provider is keyed by role so switching roles starts from that role's own subscriptions.
    <DashboardProvider role={role}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {profile.name.split(" ")[0] || "scout"}</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Your <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", getRole(role).className)}>{getRole(role).label}</span> dashboard — what matters for your job at this event.
            </p>
          </div>
        </div>

        <RoleSwitcher
          roles={roles}
          active={role}
          isAdmin={isAdmin}
          viewAs={isAdmin ? viewAs : null}
          onChange={(r) => {
            setViewAs(null);
            saveRole(r);
          }}
          onViewAs={setViewAs}
        />

        {isAdmin && <AdminStrip />}

        <DashboardBody />
      </div>
    </DashboardProvider>
  );
}

function DashboardBody() {
  const d = useDashboard();

  // Waiting on the team doc: reserve the header strip's space instead of flashing "no active event".
  if (!d.eventsLoaded) {
    return (
      <div className="flex flex-col gap-5" aria-busy>
        <Shimmer className="h-[148px]" />
        <Shimmer className="h-[232px]" />
      </div>
    );
  }

  if (!d.event) {
    return (
      <GlassPanel className="flex flex-col items-center gap-3 py-14 text-center">
        <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <div>
          <div className="font-semibold">No active event yet</div>
          <p className="max-w-md text-sm text-[var(--muted-foreground)]">
            {d.isAdmin
              ? "Pick the event (or events) the team is at, and every role's dashboard fills in with its schedule, rankings, and scouting."
              : "An admin hasn't picked an active event yet. Once they do, your dashboard will show your schedule, rankings, and scouting."}
          </p>
        </div>
        {d.isAdmin && (
          <Link href="/event">
            <Button className="h-11">Go to Active Events</Button>
          </Link>
        )}
      </GlassPanel>
    );
  }

  const widgets = dashboardRegistry[d.role];

  return (
    <>
      <HeaderStrip />
      {/* `dense` lets a small widget slide into a gap a wider one left, so rows stay full. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 [grid-auto-flow:dense]">
        {widgets.map((w) => (
          <div key={`${d.role}:${w.id}`} className={WIDGET_GRID_CLASS[w.size]}>
            <WidgetBoundary title={w.title} size={w.size}>
              {w.render()}
            </WidgetBoundary>
          </div>
        ))}
      </div>
    </>
  );
}

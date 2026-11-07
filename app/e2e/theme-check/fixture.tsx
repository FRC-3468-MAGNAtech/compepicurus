"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { AppearancePanel } from "@/components/theme/appearance-panel";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { connectionNotice } from "@/lib/connection-notice";
import { FieldTeamsContext, buildFieldTeamsValue } from "@/lib/field-teams-context";

/** The app shell (same structure as app/(app)/layout.tsx) around the Appearance panel and one sample of each glass class. */
export function ThemeCheckFixture() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sim, setSim] = useState<"online" | "offline" | "syncing">("online");
  // P19: two FTC teams and an account name, with a stateful "viewing as" choice, so the sidebar switcher is testable without Firebase.
  const [activeId, setActiveId] = useState<string | null>(null);
  const fieldTeams = buildFieldTeamsValue({
    loaded: true,
    team: {
      accountName: "Test Robotics",
      fieldTeams: [
        { id: "ft-35792", number: 35792, name: "Alpha Bots" },
        { id: "fteam_b", number: 35794, name: "Beta Builders" },
      ],
    },
    savedActiveId: activeId,
    setActive: async (id) => setActiveId(id),
  });
  const connection = sim === "online" ? null : sim === "offline" ? connectionNotice(false, 2) : connectionNotice(true, 3);

  return (
    <FieldTeamsContext.Provider value={fieldTeams}>
    <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 pb-6 pt-4 lg:px-6">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} connection={connection} />
      <div className="min-w-0 flex-1">
        <Topbar onMenuClick={() => setMobileOpen(true)} connection={connection} />
        <main className="min-w-0">
          <PageTransition>
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              <div className="flex flex-wrap gap-2" aria-label="Simulate the connection">
                {(["online", "offline", "syncing"] as const).map((s) => (
                  <button key={s} type="button" data-testid={`sim-${s}`} onClick={() => setSim(s)} className="glass-pill px-3 py-1.5 text-xs">
                    {s}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="glass-samples">
                <div data-glass="glass-panel" className="glass-panel p-4 text-sm">
                  glass-panel
                </div>
                <div data-glass="glass-card" className="glass-card p-4 text-sm">
                  glass-card
                </div>
                <div data-glass="glass-strong" className="glass-strong rounded-2xl p-4 text-sm">
                  glass-strong
                </div>
                <div data-glass="glass-pill" className="glass-pill p-3 text-center text-sm">
                  glass-pill
                </div>
                <div data-glass="glass-overlay" className="glass-overlay rounded-2xl p-4 text-sm">
                  glass-overlay
                </div>
                <GlassPanel data-glass="GlassPanel" className="text-sm">
                  GlassPanel
                </GlassPanel>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary</Button>
                <Button variant="glass">Glass</Button>
                <Button variant="outline">Outline</Button>
              </div>

              <GlassPanel id="appearance" className="flex flex-col gap-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Appearance</h2>
                <AppearancePanel />
              </GlassPanel>
            </div>
          </PageTransition>
        </main>
      </div>
    </div>
    </FieldTeamsContext.Provider>
  );
}

"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { PlaceholderBanner } from "@/components/ui/placeholder-banner";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  // /event is the one page in the app shell wired to real data (the FIRST
  // API) — every other page here still runs on lib/mock-data.ts.
  const isPlaceholderPage = !pathname.startsWith("/event");

  return (
    <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 pb-6 pt-4 lg:px-6">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="min-w-0 flex-1">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-w-0">
          {isPlaceholderPage && <PlaceholderBanner className="mb-4" />}
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}

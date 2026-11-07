"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorModeToggle } from "@/components/theme/color-mode-toggle";
import { GlassLayerButton } from "@/components/theme/glass-layer-slider";
import { SiteFooter } from "@/components/layout/site-footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col px-4 lg:px-8">
      <header className="glass-panel sticky top-4 z-30 mt-4 flex items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: "var(--theme-gradient)" }}
          >
            <Trophy className="h-[18px] w-[18px] text-[var(--color-primary-foreground)]" />
          </span>
          <span className="text-sm font-semibold sm:text-base">CompEpicurus</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <ColorModeToggle compact />
          </div>
          <GlassLayerButton compact side="bottom" />
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Log in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Sign up</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <SiteFooter className="mt-16 py-8" />
    </div>
  );
}

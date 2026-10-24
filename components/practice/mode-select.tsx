"use client";

import { Lock, Unlock } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import type { SessionMode } from "@/lib/practice-sessions";

export function ModeSelect({ onSelect }: { onSelect: (mode: Exclude<SessionMode, null>) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">Choose a mode</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GlassPanel interactive onClick={() => onSelect("trial")} className="flex flex-col items-center gap-3 py-10 text-center">
          <Unlock className="h-8 w-8 text-[var(--color-primary)]" />
          <div className="text-xl font-bold">Trial</div>
          <p className="text-sm text-[var(--muted-foreground)]">Pause, seek, and replay the video while you scout.</p>
        </GlassPanel>
        <GlassPanel interactive onClick={() => onSelect("competitive")} className="flex flex-col items-center gap-3 py-10 text-center">
          <Lock className="h-8 w-8 text-[var(--color-primary)]" />
          <div className="text-xl font-bold">Competitive</div>
          <p className="text-sm text-[var(--muted-foreground)]">The video can&apos;t be paused — just like the real thing.</p>
        </GlassPanel>
      </div>
    </div>
  );
}

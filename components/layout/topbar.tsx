"use client";

import Link from "next/link";
import { Menu, Trophy } from "lucide-react";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { ColorModeToggle } from "@/components/theme/color-mode-toggle";
import { ConnectionChip } from "@/components/layout/connection-chip";
import { GlassLayerButton } from "@/components/theme/glass-layer-slider";
import type { ConnectionNotice } from "@/lib/connection-notice";

export function Topbar({ onMenuClick, connection = null }: { onMenuClick: () => void; connection?: ConnectionNotice | null }) {
  return (
    <div className="glass-panel sticky top-[max(0.75rem,env(safe-area-inset-top))] z-20 mb-4 flex items-center justify-between gap-3 p-3 lg:hidden">
      <Link href="/dashboard" className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: "var(--theme-gradient)" }}
        >
          <Trophy className="h-4 w-4 text-[var(--color-primary-foreground)]" />
        </span>
        <span className="hidden text-sm font-semibold min-[420px]:inline">CompEpicurus</span>
      </Link>
      <div className="flex items-center gap-2">
        {/* P18: the connection chip is always here (fixed width, solid backing); the sun/moon is the light/dark mode only. */}
        <ConnectionChip connection={connection} fixedWidth />
        <ColorModeToggle compact />
        <GlassLayerButton compact side="bottom" />
        <motion.button
          whileTap={{ scale: 0.92 }}
          transition={springSnappy}
          onClick={onMenuClick}
          className="glass-pill flex h-11 w-11 items-center justify-center"
          aria-label="Open menu"
        >
          <Menu className="h-[18px] w-[18px]" />
        </motion.button>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Menu, Trophy } from "lucide-react";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="glass-panel sticky top-3 z-20 mb-4 flex items-center justify-between gap-3 p-3 lg:hidden">
      <Link href="/dashboard" className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
        >
          <Trophy className="h-4 w-4 text-white" />
        </span>
        <span className="text-sm font-semibold">CompEpicurus</span>
      </Link>
      <div className="flex items-center gap-2">
        <ThemeSwitcher compact />
        <motion.button
          whileTap={{ scale: 0.92 }}
          transition={springSnappy}
          onClick={onMenuClick}
          className="glass-pill flex h-9 w-9 items-center justify-center"
          aria-label="Open menu"
        >
          <Menu className="h-[18px] w-[18px]" />
        </motion.button>
      </div>
    </div>
  );
}

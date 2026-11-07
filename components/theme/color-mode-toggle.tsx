"use client";

import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useAppTheme } from "@/components/theme/theme-provider";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The quick light/dark switch (P18): a sun / moon button that flips the applied mode and saves it. It is only the
 * mode, never the theme (that lives in Settings > Appearance), and it never changes the theme when pressed.
 * Disabled, with the reason, while a pride theme is active: those are one fixed look.
 */
export function ColorModeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { resolvedMode, toggleColorMode, modeLocked } = useAppTheme();
  const next = resolvedMode === "dark" ? "light" : "dark";
  const label = modeLocked ? "Light and dark mode don't apply to Pride themes" : `Switch to ${next} mode`;
  const Icon = resolvedMode === "dark" ? Sun : Moon;

  return (
    <span title={label} className="inline-flex">
      <motion.button
        type="button"
        data-testid="color-mode-toggle"
        whileTap={modeLocked ? undefined : { scale: 0.92 }}
        transition={springSnappy}
        onClick={toggleColorMode}
        disabled={modeLocked}
        aria-label={label}
        className={cn(
          "glass-pill relative flex shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition-shadow duration-300 hover:text-[var(--foreground)] hover:shadow-[0_0_18px_2px_rgba(var(--glow),0.4)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none",
          compact ? "h-9 w-9" : "h-10 w-10",
          className
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </motion.button>
    </span>
  );
}

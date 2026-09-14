"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { themes } from "@/lib/themes";
import { useAppTheme } from "@/components/theme/theme-provider";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { themeId, setThemeId } = useAppTheme();
  const layoutId = useId();

  return (
    <div
      className={cn(
        "glass-pill relative flex items-center gap-1 p-1",
        compact ? "text-xs" : "text-sm"
      )}
      role="radiogroup"
      aria-label="Theme"
    >
      {themes.map((t) => {
        const active = t.id === themeId;
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={active}
            onClick={() => setThemeId(t.id)}
            className={cn(
              "relative z-10 rounded-full px-3 py-1.5 font-medium transition-colors duration-200",
              active ? "text-[var(--color-primary-foreground)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            )}
          >
            {active && (
              <motion.span
                layoutId={`theme-pill-${layoutId}`}
                transition={spring}
                className="absolute inset-0 -z-10 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${t.primary}, ${t.accent})`,
                  boxShadow: `0 4px 18px -4px rgba(${t.glowColor}, 0.6)`,
                }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: active ? "currentColor" : t.primary, opacity: active ? 0.9 : 1 }}
              />
              {t.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

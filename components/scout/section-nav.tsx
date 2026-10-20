"use client";

import { motion } from "framer-motion";
import { spring } from "@/lib/motion";

export type ScoutSection = { id: string; label: string };

export function SectionNav({ sections, activeId }: { sections: ScoutSection[]; activeId: string | null }) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="glass-pill sticky top-3 z-20 flex items-center gap-1 overflow-x-auto p-1.5">
      {sections.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollTo(s.id)}
            className="relative shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium"
          >
            {active && (
              <motion.span
                layoutId="scout-section-nav-pill"
                transition={spring}
                className="absolute inset-0 -z-10 rounded-full"
                style={{
                  background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                  boxShadow: "0 4px 18px -4px rgba(var(--glow), 0.6)",
                }}
              />
            )}
            <span className={active ? "text-[var(--color-primary-foreground)]" : "text-[var(--muted-foreground)]"}>
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

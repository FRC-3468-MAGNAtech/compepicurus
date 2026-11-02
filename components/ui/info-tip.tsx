"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A small "i" button that explains something. Opens on hover, keyboard focus,
 * or tap (touch has no hover), closes on blur/Escape/second tap. The panel
 * uses `.glass-overlay` — the solid backing for anything floating over page
 * content — so the text stays legible in every theme.
 */
export function InfoTip({
  label,
  children,
  className,
  align = "end",
}: {
  /** Accessible name of the button, e.g. "About the accuracy filter". */
  label: string;
  children: React.ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const id = useId();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;

  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        onBlur={() => setPinned(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setPinned(false);
            setHover(false);
          }
        }}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted-foreground)] outline-none transition-colors hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
      >
        <Info className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={spring}
            className={cn(
              "glass-overlay absolute top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl p-3 text-xs leading-relaxed shadow-2xl",
              align === "end" ? "right-0" : "left-0"
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

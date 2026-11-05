"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Wraps any inline content so a tooltip opens on hover, keyboard focus, or tap
 * (touch has no hover). Unlike `InfoTip` there's no "i" button — the wrapped
 * content itself is the trigger (a column label, a percentage). The panel is
 * `.glass-overlay`, the solid backing for anything floating over page content,
 * so the text stays legible in every theme.
 */
export function HoverTip({
  content,
  children,
  className,
  align = "center",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
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
      <span
        tabIndex={0}
        role="button"
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setHover(true)}
        onBlur={() => {
          setHover(false);
          setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setHover(false);
            setPinned(false);
          }
        }}
        className="cursor-help rounded outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
      >
        {children}
      </span>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={spring}
            className={cn(
              "glass-overlay pointer-events-none absolute top-full z-50 mt-2 block w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-xl p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-[var(--foreground)] shadow-2xl",
              align === "start" && "left-0",
              align === "end" && "right-0",
              align === "center" && "left-1/2 -translate-x-1/2"
            )}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Droplets, RotateCcw } from "lucide-react";
import { DEFAULT_GLASS_SHADE, GLASS_SHADE_MAX, GLASS_SHADE_MIN, useGlassShade } from "@/lib/glass-shade";
import { useGlassOverlap } from "@/lib/use-glass-overlap";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

const POPOVER_WIDTH = 256;
const GAP = 8;

export function GlassShadeControl({ compact = false, side = "top" }: { compact?: boolean; side?: "top" | "bottom" }) {
  const { shade, setShade } = useGlassShade();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const overGlass = useGlassOverlap(popoverRef, open);

  // Rendered via a portal to document.body — several of this button's real
  // placements (the sidebar, in particular) have `overflow-hidden` for their
  // own layout/collapse-animation reasons, which would otherwise clip this
  // popover instead of letting it float above the page. Position is computed
  // from the trigger's own rect rather than relying on CSS containment.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8);
      const top = side === "top" ? rect.top - GAP : rect.bottom + GAP;
      setCoords({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <motion.button
        ref={triggerRef}
        type="button"
        whileTap={{ scale: 0.92 }}
        transition={springSnappy}
        onClick={() => setOpen((o) => !o)}
        aria-label="Adjust glass shading"
        aria-expanded={open}
        className={cn(
          "glass-pill flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          compact ? "h-9 w-9" : "h-10 w-10"
        )}
      >
        <Droplets className="h-[18px] w-[18px]" />
      </motion.button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={popoverRef}
                initial={{ opacity: 0, scale: 0.96, y: side === "top" ? 4 : -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: side === "top" ? 4 : -4 }}
                transition={springSnappy}
                className="glass-overlay fixed z-50 rounded-2xl p-4 shadow-2xl"
                style={{
                  width: POPOVER_WIDTH,
                  left: coords.left,
                  top: side === "top" ? undefined : coords.top,
                  bottom: side === "top" ? window.innerHeight - coords.top : undefined,
                  ...(overGlass ? {} : ({ "--glass-shade": 1 } as React.CSSProperties)),
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">Glass shading</span>
                  <button
                    type="button"
                    onClick={() => setShade(DEFAULT_GLASS_SHADE)}
                    className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    <RotateCcw className="h-3 w-3" /> Reset
                  </button>
                </div>
                <input
                  type="range"
                  min={GLASS_SHADE_MIN}
                  max={GLASS_SHADE_MAX}
                  step={0.05}
                  value={shade}
                  onChange={(e) => setShade(Number(e.target.value))}
                  className="w-full accent-[var(--color-primary)]"
                  aria-label="Glass shading intensity"
                />
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                  <span>More see-through</span>
                  <span className="font-medium text-[var(--foreground)]">{Math.round(shade * 100)}%</span>
                  <span>More solid</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

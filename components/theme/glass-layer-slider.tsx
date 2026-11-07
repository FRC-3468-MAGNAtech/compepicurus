"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Droplets, RotateCcw } from "lucide-react";
import { GLASS_LAYER_MAX, GLASS_LAYER_MIN, GLASS_LAYER_STEP, formatGlassLayerLevel } from "@/lib/glass-layer-level";
import { useGlassLayerLevel } from "@/lib/glass-layer";
import { useGlassOverlap } from "@/lib/use-glass-overlap";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

const POPOVER_WIDTH = 256;
const GAP = 8;

/**
 * The layered-glass slider itself (FIX3): how see-through or solid glass boxes
 * are, most noticeable where glass sits on glass. One component, one state
 * (`useGlassLayerLevel`), so every place it appears — the sidebar's droplet popover,
 * the top bar's, the home page header's — moves together and is saved to the user.
 * A native range input, so the arrow keys, Home/End, and Page Up/Down all work.
 */
export const GlassLayerSlider = ({ inputRef }: { inputRef?: React.Ref<HTMLInputElement> }) => {
  const { level, setLevel, reset } = useGlassLayerLevel();
  const labelId = useId();
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span id={labelId} className="text-sm font-semibold">
          Glass shading
        </span>
        <button type="button" onClick={reset} className="flex items-center gap-1 rounded text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(var(--glow),0.6)]">
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>
      <input
        ref={inputRef}
        type="range"
        min={GLASS_LAYER_MIN}
        max={GLASS_LAYER_MAX}
        step={GLASS_LAYER_STEP}
        value={level}
        onChange={(e) => setLevel(Number(e.target.value))}
        className="h-6 w-full accent-[var(--color-primary)]"
        aria-labelledby={labelId}
        aria-valuetext={`${formatGlassLayerLevel(level)} — ${level < 1 ? "more see-through" : level > 1 ? "more solid" : "default"}`}
      />
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
        <span>More see-through</span>
        <span className="font-medium text-[var(--foreground)]">{formatGlassLayerLevel(level)}</span>
        <span>More solid</span>
      </div>
    </div>
  );
};

/**
 * The circular water-droplet button that opens the glass slider in a popover. (FIX3 also hung the offline /
 * unsynced-submissions badge on it; P18 moved that to its own always-visible chip, components/layout/connection-chip.tsx,
 * so there is exactly one indicator.) Closes on outside click or Escape.
 */
export function GlassLayerButton({ compact = false, side = "top" }: { compact?: boolean; side?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const overGlass = useGlassOverlap(popoverRef, open);
  const dialogId = useId();

  // Rendered via a portal to document.body — several of this button's real placements (the
  // sidebar, in particular) have `overflow-hidden` for their own layout/collapse-animation
  // reasons, which would otherwise clip the popover. Position comes from the trigger's rect.
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
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus(); // hand focus back to the button
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Put the keyboard on the slider as soon as the popover is up, so the arrow keys work immediately.
  useEffect(() => {
    if (open && coords) sliderRef.current?.focus({ preventScroll: true });
  }, [open, coords]);

  const label = "Adjust glass shading";

  return (
    <>
      <motion.button
        ref={triggerRef}
        type="button"
        whileTap={{ scale: 0.92 }}
        transition={springSnappy}
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dialogId : undefined}
        className={cn(
          "glass-pill relative flex shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition-shadow duration-300 hover:text-[var(--foreground)] hover:shadow-[0_0_18px_2px_rgba(var(--glow),0.4)]",
          open && "text-[var(--foreground)] shadow-[0_0_18px_2px_rgba(var(--glow),0.45)]",
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
                id={dialogId}
                ref={popoverRef}
                role="dialog"
                aria-label="Glass shading"
                initial={{ opacity: 0, scale: 0.96, y: side === "top" ? 4 : -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: side === "top" ? 4 : -4 }}
                transition={springSnappy}
                className="glass-overlay fixed z-50 flex flex-col gap-3 rounded-2xl p-4 shadow-2xl"
                style={{
                  width: POPOVER_WIDTH,
                  left: coords.left,
                  top: side === "top" ? undefined : coords.top,
                  bottom: side === "top" ? window.innerHeight - coords.top : undefined,
                  ...(overGlass ? {} : ({ "--glass-shade": 1 } as React.CSSProperties)),
                }}
              >
                <GlassLayerSlider inputRef={sliderRef} />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

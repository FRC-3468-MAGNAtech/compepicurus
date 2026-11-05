"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { EPA_TOOLTIP } from "@/components/pick-list/pick-stats";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EpaMode } from "@/lib/pick-list/store";
import { spring } from "@/lib/motion";

/**
 * The Pick List's column settings: today just "EPA: Calculated / Off". The
 * panel is a floating popover, so it uses `.glass-overlay` (solid backing).
 * The choice is remembered per user (see `useEpaMode`).
 */
export function ColumnSettings({ epaMode, onEpaModeChange }: { epaMode: EpaMode; onEpaModeChange: (mode: EpaMode) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button variant="glass" className="h-11 gap-2" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal className="h-4 w-4" /> Columns
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Column settings"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={spring}
            className="glass-overlay absolute right-0 top-full z-50 mt-2 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 rounded-2xl p-4 shadow-2xl"
          >
            <div>
              <div className="text-sm font-semibold">EPA</div>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{EPA_TOOLTIP}</p>
            </div>
            <Tabs value={epaMode} onValueChange={(v) => onEpaModeChange(v as EpaMode)}>
              <TabsList className="w-full">
                <TabsTrigger value="calculated" className="flex-1">
                  Calculated
                </TabsTrigger>
                <TabsTrigger value="off" className="flex-1">
                  Off
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-[11px] text-[var(--muted-foreground)]">Remembered for you on this device.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { connectionStatus, type ConnectionNotice } from "@/lib/connection-notice";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

const DOT_COLOR = {
  online: "var(--status-online)",
  offline: "var(--status-offline)",
  syncing: "var(--status-syncing)",
} as const;

function Dot({ tone }: { tone: "online" | "offline" | "syncing" }) {
  return (
    <span
      aria-hidden
      className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone === "syncing" && "animate-pulse")}
      style={{ background: DOT_COLOR[tone], boxShadow: `0 0 8px 1px color-mix(in srgb, ${DOT_COLOR[tone]} 55%, transparent)` }}
    />
  );
}

/**
 * The internet status chip (P18): ALWAYS visible, with a solid backing (`--surface-solid`, a fully opaque theme
 * color, so glass transparency and whatever is behind it never affect it). Online (green dot), Offline (red), or
 * Syncing N (amber, pulsing) while submissions wait to upload. Fixed height and a fixed width per placement, so it
 * never shifts the layout when the state changes. `collapsed` shows only the dot, with a tooltip.
 */
export function ConnectionChip({
  connection,
  collapsed = false,
  fixedWidth = false,
  className,
}: {
  connection: ConnectionNotice | null;
  /** Dot only (the collapsed sidebar), with the full sentence in a tooltip. */
  collapsed?: boolean;
  /** A set width instead of filling the row (the mobile top bar), so the label changing can't move its neighbors. */
  fixedWidth?: boolean;
  className?: string;
}) {
  const status = connectionStatus(connection);
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const showTip = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ top: r.top + r.height / 2, left: r.right + 10 });
  };

  const common = "flex h-8 items-center rounded-full border border-[var(--glass-border)] bg-[var(--surface-solid)] text-xs font-medium text-[var(--foreground)]";

  if (collapsed) {
    return (
      <>
        <div
          ref={ref}
          role="status"
          aria-live="polite"
          aria-label={status.detail}
          data-testid="connection-chip"
          data-tone={status.tone}
          tabIndex={0}
          onPointerEnter={(e) => e.pointerType === "mouse" && showTip()}
          onPointerLeave={() => setTip(null)}
          onFocus={showTip}
          onBlur={() => setTip(null)}
          onClick={() => (tip ? setTip(null) : showTip())}
          className={cn(common, "touch-compact w-8 shrink-0 justify-center", className)}
        >
          <Dot tone={status.tone} />
        </div>
        {typeof document !== "undefined" &&
          createPortal(
            <AnimatePresence>
              {tip && (
                <motion.div
                  role="tooltip"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={springSnappy}
                  className="glass-overlay pointer-events-none fixed z-50 max-w-[240px] rounded-xl px-3 py-2 text-xs text-[var(--foreground)] shadow-2xl"
                  style={{ top: tip.top, left: tip.left, translate: "0 -50%" }}
                >
                  {status.detail}
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
      </>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={status.detail}
      title={status.detail}
      data-testid="connection-chip"
      data-tone={status.tone}
      className={cn(common, "gap-2 px-3", fixedWidth ? "w-[6.75rem] shrink-0 justify-center" : "w-full", className)}
    >
      <Dot tone={status.tone} />
      <span className="truncate whitespace-nowrap">{status.label}</span>
    </div>
  );
}

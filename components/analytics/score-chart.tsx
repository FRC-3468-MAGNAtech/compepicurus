"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { niceTicks } from "@/lib/analytics/chart";
import type { MatchScouted } from "@/lib/analytics/team-stats";
import { springSnappy } from "@/lib/motion";

// Single-series line chart (total score per scouted match) in plain SVG on
// the theme tokens — no chart dependency. One series, so no legend: the card
// title names it. The match list beside it on Team Profile is the table view
// of the same numbers.

const HEIGHT = 260;
const PAD = { top: 16, right: 20, bottom: 34, left: 44 };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ScoreChart({ matches, average }: { matches: MatchScouted[]; average: number }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const n = matches.length;
  const ticks = useMemo(() => niceTicks(Math.max(average, ...matches.map((m) => m.total))), [matches, average]);
  const yMax = ticks[ticks.length - 1];

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const path = matches.map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(m.total).toFixed(1)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 48))));
  // A dense series would drown in 8px markers; show them only for the hovered match.
  const showMarkers = n <= 40;

  const moveTo = (clientX: number, rect: DOMRect) => {
    if (n === 0 || innerW <= 0) return;
    const px = clientX - rect.left - PAD.left;
    const i = n === 1 ? 0 : Math.round((px / innerW) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  };

  const activeMatch = active !== null ? matches[active] : null;
  const tooltipLeft = active !== null ? x(active) : 0;
  const flip = width > 0 && tooltipLeft > width * 0.6;

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] rounded-xl"
      tabIndex={0}
      role="group"
      aria-label={`Total score by match, ${n} ${n === 1 ? "match" : "matches"}, average ${average.toFixed(1)}. Use the left and right arrow keys to read each match.`}
      onKeyDown={(e) => {
        if (n === 0) return;
        if (e.key === "ArrowRight") setActive((a) => (a === null ? 0 : Math.min(n - 1, a + 1)));
        else if (e.key === "ArrowLeft") setActive((a) => (a === null ? n - 1 : Math.max(0, a - 1)));
        else if (e.key === "Escape") setActive(null);
        else return;
        e.preventDefault();
      }}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-hidden
          onPointerMove={(e) => moveTo(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          className="touch-pan-y"
        >
          {/* gridlines: hairline, solid, recessive */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--glass-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)" className="tabular-nums">
                {t}
              </text>
            </g>
          ))}

          {/* average reference, labelled directly */}
          <line x1={PAD.left} x2={width - PAD.right} y1={y(average)} y2={y(average)} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.55} />
          <text x={width - PAD.right} y={y(average) - 5} textAnchor="end" fontSize={11} fill="var(--muted-foreground)" className="tabular-nums">
            Avg {average.toFixed(1)}
          </text>

          {/* x labels */}
          {matches.map((m, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={m.entryId} x={x(i)} y={HEIGHT - 12} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
                {m.label}
              </text>
            ) : null
          )}

          {/* crosshair snaps to the nearest match */}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.6} />}

          {n > 1 && <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

          {matches.map((m, i) =>
            showMarkers || i === active ? (
              <circle
                key={m.entryId}
                cx={x(i)}
                cy={y(m.total)}
                r={i === active ? 5 : 4}
                fill="var(--color-accent)"
                // 2px ring in the surface colour keeps overlapping markers distinct
                stroke="var(--background)"
                strokeWidth={2}
              />
            ) : null
          )}
        </svg>
      )}

      <AnimatePresence>
        {activeMatch && (
          <motion.div
            role="status"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={springSnappy}
            className="glass-overlay pointer-events-none absolute z-10 w-44 rounded-xl p-3 text-xs shadow-xl"
            style={{ top: PAD.top, left: flip ? undefined : tooltipLeft + 12, right: flip ? width - tooltipLeft + 12 : undefined }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[var(--muted-foreground)]">{activeMatch.label}</span>
              <span className="text-[var(--muted-foreground)]">{activeMatch.eventCode}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: "var(--color-accent)" }} />
              <span className="text-lg font-semibold tabular-nums">{activeMatch.total}</span>
              <span className="text-[var(--muted-foreground)]">total</span>
            </div>
            <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[var(--muted-foreground)]">
              <dt>Auto</dt>
              <dd className="tabular-nums text-[var(--foreground)]">{activeMatch.auto}</dd>
              <dt>Teleop</dt>
              <dd className="tabular-nums text-[var(--foreground)]">{activeMatch.teleop}</dd>
              <dt>Endgame</dt>
              <dd className="tabular-nums text-[var(--foreground)]">{activeMatch.endgame}</dd>
              <dt>Accuracy</dt>
              <dd className="tabular-nums text-[var(--foreground)]">{activeMatch.accuracy === null ? "—" : `${Math.round(activeMatch.accuracy)}%`}</dd>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

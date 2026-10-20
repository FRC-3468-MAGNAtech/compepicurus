"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import { getPlayoffBracket } from "@/lib/ftc/actions";
import type { BracketMatch, BracketStructure, FtcMatch } from "@/lib/ftc/types";
import { cn } from "@/lib/utils";

// Fixed 8-alliance double-elimination bracket shape (FIRST's standard format,
// verified against a real completed event this session). Positions are a
// hand-placed logical grid — not inferred from any reference image — so the
// bracket can always render its full 15-slot scaffold even before any
// playoff data exists, per the "show placeholders until resolved" spec.
type SlotId =
  | "M1" | "M2" | "M3" | "M4"
  | "M5" | "M6" | "M7" | "M8"
  | "M9" | "M10" | "M11" | "M12" | "M13"
  | "M14" | "M15";

type Slot = {
  id: SlotId;
  col: number;
  row: number;
  redPlaceholder: string;
  bluePlaceholder: string;
  ghost?: boolean;
};

const SLOTS: Slot[] = [
  { id: "M1", col: 0, row: 0, redPlaceholder: "Alliance 1", bluePlaceholder: "Alliance 8" },
  { id: "M2", col: 0, row: 1, redPlaceholder: "Alliance 4", bluePlaceholder: "Alliance 5" },
  { id: "M3", col: 0, row: 2, redPlaceholder: "Alliance 2", bluePlaceholder: "Alliance 7" },
  { id: "M4", col: 0, row: 3, redPlaceholder: "Alliance 3", bluePlaceholder: "Alliance 6" },

  { id: "M7", col: 1, row: 0.5, redPlaceholder: "Winner M1", bluePlaceholder: "Winner M2" },
  { id: "M8", col: 1, row: 2.5, redPlaceholder: "Winner M3", bluePlaceholder: "Winner M4" },
  { id: "M5", col: 1, row: 4.5, redPlaceholder: "Loser M1", bluePlaceholder: "Loser M2" },
  { id: "M6", col: 1, row: 6.5, redPlaceholder: "Loser M3", bluePlaceholder: "Loser M4" },

  { id: "M10", col: 2, row: 2.75, redPlaceholder: "Loser M8", bluePlaceholder: "Winner M5" },
  { id: "M9", col: 2, row: 4.25, redPlaceholder: "Loser M7", bluePlaceholder: "Winner M6" },

  { id: "M11", col: 3, row: 1.5, redPlaceholder: "Winner M7", bluePlaceholder: "Winner M8" },
  { id: "M12", col: 3, row: 3.5, redPlaceholder: "Winner M10", bluePlaceholder: "Winner M9" },

  { id: "M13", col: 4, row: 2.5, redPlaceholder: "Loser M11", bluePlaceholder: "Winner M12" },

  { id: "M14", col: 5, row: 2, redPlaceholder: "Winner M11", bluePlaceholder: "Winner M13" },
  { id: "M15", col: 5, row: 3.4, redPlaceholder: "Loser M14", bluePlaceholder: "Winner M14", ghost: true },
];

const EDGES: [SlotId, SlotId][] = [
  ["M1", "M7"], ["M1", "M5"],
  ["M2", "M7"], ["M2", "M5"],
  ["M3", "M8"], ["M3", "M6"],
  ["M4", "M8"], ["M4", "M6"],
  ["M7", "M11"], ["M7", "M9"],
  ["M8", "M11"], ["M8", "M10"],
  ["M5", "M10"],
  ["M6", "M9"],
  ["M9", "M12"],
  ["M10", "M12"],
  ["M11", "M13"], ["M11", "M14"],
  ["M12", "M13"],
  ["M13", "M14"],
  ["M14", "M15"],
];

const COL_WIDTH = 190;
const ROW_HEIGHT = 56;
const BOX_WIDTH = 158;
const BOX_HEIGHT = 48;

function slotPixel(slot: Slot) {
  return { x: slot.col * COL_WIDTH, y: slot.row * ROW_HEIGHT };
}

type SlotMatchMap = Partial<Record<SlotId, BracketMatch>>;

function mapBracketToSlots(bracket: BracketStructure | null): { slots: SlotMatchMap; unrecognizedCount: number } {
  if (!bracket || bracket.format !== "double-elim-8") {
    return { slots: {}, unrecognizedCount: bracket?.format === "unknown" ? bracket.matches.length : 0 };
  }
  const { upperBracket, lowerBracket, finals } = bracket;
  const upper = (round: number) => upperBracket.find((r) => r.round === round)?.matches ?? [];
  const lower = (round: number) => lowerBracket.find((r) => r.round === round)?.matches ?? [];

  const slots: SlotMatchMap = {};
  const assign = (id: SlotId, match: BracketMatch | undefined) => {
    if (match) slots[id] = match;
  };
  const [m1, m2, m3, m4] = upper(1);
  assign("M1", m1);
  assign("M2", m2);
  assign("M3", m3);
  assign("M4", m4);
  const [m7, m8] = upper(2);
  assign("M7", m7);
  assign("M8", m8);
  assign("M11", upper(4)[0]);
  const [m5, m6] = lower(2);
  assign("M5", m5);
  assign("M6", m6);
  const [m9, m10] = lower(3);
  assign("M9", m9);
  assign("M10", m10);
  assign("M12", lower(4)[0]);
  assign("M13", lower(5)[0]);
  assign("M14", finals[0]);
  assign("M15", finals[1]);

  return { slots, unrecognizedCount: 0 };
}

export function BracketPicker({
  eventCode,
  season,
  onSelect,
}: {
  eventCode: string;
  season: number;
  onSelect: (match: FtcMatch) => void;
}) {
  const bracketQuery = useFtcQuery(`bracket:${eventCode}:${season}`, () => getPlayoffBracket(eventCode, season));

  const { slots, unrecognizedCount } = useMemo(() => mapBracketToSlots(bracketQuery.data), [bracketQuery.data]);

  const width = (Math.max(...SLOTS.map((s) => s.col)) + 1) * COL_WIDTH + 24;
  const height = (Math.max(...SLOTS.map((s) => s.row)) + 1) * ROW_HEIGHT + BOX_HEIGHT;

  if (bracketQuery.status === "loading") {
    return <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">Loading bracket…</div>;
  }
  if (bracketQuery.status === "error") {
    return (
      <div className="glass-card flex flex-col items-center gap-2 p-6 text-center text-sm text-[var(--muted-foreground)]">
        Couldn&apos;t load the playoff bracket &mdash; {bracketQuery.error?.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {unrecognizedCount > 0 && (
        <div className="glass-card flex items-center gap-2 p-3 text-xs text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This event has {unrecognizedCount} playoff match{unrecognizedCount === 1 ? "" : "es"} that don&apos;t match
          the expected 8-alliance bracket shape &mdash; showing an empty scaffold instead of guessing.
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-[var(--glass-border)] bg-black/10 p-3">
        <div className="relative" style={{ width, height }}>
          <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
            {EDGES.map(([fromId, toId]) => {
              const from = SLOTS.find((s) => s.id === fromId)!;
              const to = SLOTS.find((s) => s.id === toId)!;
              const fromPx = slotPixel(from);
              const toPx = slotPixel(to);
              const x1 = fromPx.x + BOX_WIDTH;
              const y1 = fromPx.y + BOX_HEIGHT / 2;
              const x2 = toPx.x;
              const y2 = toPx.y + BOX_HEIGHT / 2;
              const xMid = x1 + (COL_WIDTH - BOX_WIDTH) / 2;
              return (
                <path
                  key={`${fromId}-${toId}`}
                  d={`M ${x1} ${y1} L ${xMid} ${y1} L ${xMid} ${y2} L ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--glass-border)"
                  strokeWidth={2}
                  strokeDasharray={toId === "M15" ? "4 4" : undefined}
                />
              );
            })}
          </svg>
          {SLOTS.map((slot) => (
            <BracketBox key={slot.id} slot={slot} bracketMatch={slots[slot.id]} onSelect={onSelect} />
          ))}
        </div>
      </div>
      <p className="text-center text-xs text-[var(--muted-foreground)]">
        If the winner of M13 also wins M14, one additional match (M15) decides the final.
      </p>
    </div>
  );
}

function BracketBox({
  slot,
  bracketMatch,
  onSelect,
}: {
  slot: Slot;
  bracketMatch: BracketMatch | undefined;
  onSelect: (match: FtcMatch) => void;
}) {
  const { x, y } = slotPixel(slot);
  const hasRealData = !!bracketMatch?.match;
  const redLabel = bracketMatch?.red?.teams.join(", ") || slot.redPlaceholder;
  const blueLabel = bracketMatch?.blue?.teams.join(", ") || slot.bluePlaceholder;
  const winner = bracketMatch?.winner ?? null;

  return (
    <button
      type="button"
      disabled={!hasRealData}
      onClick={() => bracketMatch?.match && onSelect(bracketMatch.match)}
      style={{ position: "absolute", left: x, top: y, width: BOX_WIDTH, height: BOX_HEIGHT }}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border text-[11px] font-medium",
        hasRealData
          ? "border-[var(--glass-border)] shadow-md transition-transform hover:scale-[1.04]"
          : "border-dashed border-[var(--glass-border)] opacity-60",
        slot.ghost && "opacity-50"
      )}
    >
      <span className="bg-black/40 px-2 py-0.5 text-left text-[10px] text-[var(--muted-foreground)]">
        {slot.id}
        {slot.ghost && " (if needed)"}
      </span>
      <span
        className={cn(
          "flex flex-1 items-center truncate bg-red-500/20 px-2 text-red-200",
          winner === "red" && "ring-1 ring-inset ring-emerald-400"
        )}
      >
        {redLabel}
      </span>
      <span
        className={cn(
          "flex flex-1 items-center truncate bg-blue-500/20 px-2 text-blue-200",
          winner === "blue" && "ring-1 ring-inset ring-emerald-400"
        )}
      >
        {blueLabel}
      </span>
    </button>
  );
}

"use client";

import { HoverTip } from "@/components/ui/hover-tip";
import { describePickGap, formatPickLikelihood, pickLikelihoodColor, PICK_ESTIMATE_LABEL } from "@/lib/pickLikelihood";
import type { PickRow } from "@/lib/pick-list/rows";
import { cn } from "@/lib/utils";

export const EPA_TOOLTIP = "Estimated points a team adds to an alliance, calculated from official scores only.";

const dash = (v: number | null, digits = 1) => (v === null ? "-" : v.toFixed(digits));

/**
 * The six numbers on every row: O. Rank, S. Rank, S. Avg, S. High, O. EPA, and
 * Pick %. "O." columns are official FIRST data (untouched by the accuracy
 * filter); "S." columns are scouted and follow the shared filters. `?` means
 * a team has no scouted data to rank; `-` means a value isn't available.
 */
export function PickStats({ row, ourRank, showEpa, className }: { row: PickRow; ourRank: number | null; showEpa: boolean; className?: string }) {
  const cells: React.ReactNode[] = [
    <Cell key="o" label="O. Rank" value={row.oRank === null ? "-" : String(row.oRank)} />,
    <Cell key="s" label="S. Rank" value={row.sRank === null ? "?" : String(row.sRank)} />,
    <Cell key="avg" label="S. Avg" value={dash(row.sAvg)} />,
    <Cell key="high" label="S. High" value={row.sHigh === null ? "-" : String(row.sHigh)} />,
  ];
  if (showEpa) {
    cells.push(
      <Cell
        key="epa"
        label="O. EPA"
        value={dash(row.epa)}
        labelTip={EPA_TOOLTIP}
      />
    );
  }
  cells.push(
    <Cell
      key="pick"
      label="Pick %"
      value={formatPickLikelihood(row.pickPct)}
      valueColor={pickLikelihoodColor(row.pickPct)}
      valueTip={
        <>
          <strong className="block">{PICK_ESTIMATE_LABEL}</strong>
          <span className="text-[var(--muted-foreground)]">{describePickGap(row.oRank, ourRank)}</span>
        </>
      }
    />
  );

  return (
    <div className={cn("grid gap-1", showEpa ? "grid-cols-6" : "grid-cols-5", className)} role="group" aria-label="Team stats">
      {cells}
    </div>
  );
}

function Cell({
  label,
  value,
  valueColor,
  labelTip,
  valueTip,
}: {
  label: string;
  value: string;
  valueColor?: string;
  labelTip?: React.ReactNode;
  valueTip?: React.ReactNode;
}) {
  const labelEl = <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>;
  const valueEl = (
    <span className="text-sm font-semibold tabular-nums" style={valueColor ? { color: valueColor } : undefined}>
      {value}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-lg bg-white/5 px-1 py-1.5 text-center">
      {labelTip ? <HoverTip content={labelTip}>{labelEl}</HoverTip> : labelEl}
      {valueTip ? (
        <HoverTip content={valueTip} align="end">
          {valueEl}
        </HoverTip>
      ) : (
        valueEl
      )}
    </div>
  );
}

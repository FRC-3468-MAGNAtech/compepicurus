"use client";

import { Pin } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import type { PickRow } from "@/lib/pick-list/rows";

/**
 * Our own team, pinned above the board and kept out of both lists: our
 * official rank, scouted rank, and record — the numbers every Pick % is
 * measured from.
 */
export function OurTeamCard({
  teamNumber,
  row,
  showEpa,
  switcher,
}: {
  teamNumber: number | null;
  row: PickRow | null;
  showEpa: boolean;
  /** P19: a control to choose which of the account's FTC teams this card (and every Pick % on the board) is measured from. */
  switcher?: React.ReactNode;
}) {
  const record = row?.record ? `${row.record.wins}-${row.record.losses}-${row.record.ties}` : "-";
  const stats: { label: string; value: string }[] = [
    { label: "Official rank", value: row?.oRank == null ? "-" : `#${row.oRank}` },
    { label: "Scouted rank", value: row?.sRank == null ? "?" : `#${row.sRank}` },
    { label: "Record", value: record },
  ];
  if (row?.rankingPoints != null) stats.push({ label: "Ranking pts", value: row.rankingPoints.toFixed(2) });
  if (showEpa) stats.push({ label: "O. EPA", value: row?.epa == null ? "-" : row.epa.toFixed(1) });

  return (
    <GlassPanel strong className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: "rgba(var(--glow), 0.16)" }}>
          <Pin className="h-5 w-5" style={{ color: "var(--color-primary)" }} />
        </span>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Our team</div>
          <div className="text-xl font-semibold tabular-nums">
            {teamNumber ?? "—"}
            {row?.teamName && <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">{row.teamName}</span>}
          </div>
        </div>
        {switcher && <div className="ml-2">{switcher}</div>}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </GlassPanel>
  );
}

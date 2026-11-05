"use client";

import { useMemo } from "react";
import { ReliabilityPill } from "@/components/analytics/reliability-pill";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber, teamHref } from "@/components/dashboard/shared";
import { Check, Medal, Star } from "lucide-react";
import { useDashboard } from "@/lib/dashboard/data";
import { strengthBullets } from "@/lib/dashboard/insights";
import { formatRecord } from "@/lib/dashboard/schedule";

/** Our team on one card: official rank and record, average scored, and reliability. */
export function TeamSummaryWidget() {
  const d = useDashboard();
  const stats = d.ourStats;

  return (
    <Widget
      title="Our team summary"
      icon={Medal}
      size="medium"
      status={d.first.loading || !d.entriesLoaded ? "loading" : "ready"}
      href={d.ourNumber !== null ? teamHref(d.ourNumber, d.event?.code ?? null) : undefined}
      linkLabel="Our team profile"
    >
      <div className="grid grid-cols-3 gap-3">
        <KeyNumber label="Rank" value={d.ourRanking ? `#${d.ourRanking.rank}` : "-"} />
        <KeyNumber label="Record" value={formatRecord(d.record)} />
        <KeyNumber label="Avg scored" value={stats ? stats.avgTotal.toFixed(1) : "-"} hint={stats ? `${stats.entryCount} scouted` : "Not scouted yet"} />
      </div>
      {stats && <div className="flex flex-wrap items-center gap-2"><ReliabilityPill team={stats} schema={d.schema} /></div>}
    </Widget>
  );
}

/** Talking points generated from our own numbers — each one appears only while it's true. */
export function StrengthBulletsWidget() {
  const d = useDashboard();
  const bullets = useMemo(
    () => strengthBullets({ stats: d.ourStats, schema: d.schema, scoutedRank: d.ourScoutedRank, fieldSize: d.fieldSize, officialRank: d.ourRanking?.rank ?? null, record: d.record }),
    [d.ourStats, d.schema, d.ourScoutedRank, d.fieldSize, d.ourRanking, d.record]
  );

  return (
    <Widget
      title="Our strengths"
      icon={Star}
      size="medium"
      status={d.first.loading || !d.entriesLoaded ? "loading" : bullets.length === 0 ? "empty" : "ready"}
      href={d.ourNumber !== null ? teamHref(d.ourNumber, d.event?.code ?? null) : undefined}
      linkLabel="Our team profile"
      emptyText="Strengths appear here as more of our matches are scouted and results come in."
    >
      <ul className="flex flex-col gap-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Widget>
  );
}

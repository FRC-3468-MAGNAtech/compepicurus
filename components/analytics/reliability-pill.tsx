"use client";

import { AlertOctagon, CheckCircle2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { reliabilityIncidents, reliabilityLevel, type ReliabilityLevel } from "@/lib/analytics/team-card";
import type { TeamStats } from "@/lib/analytics/team-stats";
import type { ScoutFormSchema } from "@/lib/scout-form/schema";

const RELIABILITY_STYLE: Record<Exclude<ReliabilityLevel, "unknown">, { label: string; variant: "success" | "warning" | "danger"; Icon: typeof CheckCircle2 }> = {
  reliable: { label: "Reliable", variant: "success", Icon: CheckCircle2 },
  "some-issues": { label: "Some issues", variant: "warning", Icon: TriangleAlert },
  unreliable: { label: "Unreliable", variant: "danger", Icon: AlertOctagon },
};

/** Reliability from the share of entries with no died / never-started / disabled / froze / tipped incident. Icon + word + number, never colour alone. Renders nothing when the schema has no reliability fields. */
export function ReliabilityPill({ team, schema }: { team: TeamStats; schema: ScoutFormSchema }) {
  const level = reliabilityLevel(team.reliability);
  if (level === "unknown" || team.reliability === null) return null;
  const { label, variant, Icon } = RELIABILITY_STYLE[level];
  const incidents = reliabilityIncidents(team, schema);
  const detail = incidents.length === 0 ? "No reliability incidents scouted" : incidents.map((i) => `${i.label} ${Math.round(i.rate)}%`).join(" · ");

  return (
    <Badge variant={variant} className="gap-1.5" title={`${Math.round(team.reliability)}% of entries incident-free. ${detail}`}>
      <Icon className="h-3.5 w-3.5" />
      {label} <span className="font-normal tabular-nums opacity-80">{Math.round(team.reliability)}%</span>
    </Badge>
  );
}

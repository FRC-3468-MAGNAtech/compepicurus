"use client";

import { CalendarClock, MapPin, Trophy } from "lucide-react";
import { AllianceChip, Countdown, TeamLink } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shimmer } from "@/components/ui/shimmer";
import { useDashboard, useOurTeamEvent } from "@/lib/dashboard/data";
import { formatRecord } from "@/lib/dashboard/schedule";
import type { EventLifecycleStatus } from "@/lib/ftc/types";

const STATUS: Record<EventLifecycleStatus, { label: string; variant: "success" | "glass" | "outline" }> = {
  "in-progress": { label: "In Progress", variant: "success" },
  upcoming: { label: "Upcoming", variant: "glass" },
  completed: { label: "Completed", variant: "outline" },
};

/**
 * The strip every role sees: the event (with a switcher when several are
 * active), our official rank and record, and our next match with its scheduled
 * time, alliance color, and partner. All of it comes from `useOurTeamEvent()`,
 * so it costs nothing beyond what the widgets already share. Its height is
 * fixed on loading so the grid below doesn't move.
 */
export function HeaderStrip() {
  const d = useDashboard();
  const t = useOurTeamEvent();
  const status = t.eventStatus ? STATUS[t.eventStatus] : null;
  const next = t.nextMatch;
  const code = t.event?.code ?? null;

  return (
    <GlassPanel strong className="grid grid-cols-1 gap-x-8 gap-y-4 p-5 md:grid-cols-3">
      {/* Event */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          <MapPin className="h-3.5 w-3.5" /> Event
        </div>
        {d.events.length > 1 ? (
          <Select value={t.event?.code ?? ""} onValueChange={d.setEventCode}>
            <SelectTrigger className="h-11" aria-label="Choose an active event">
              <SelectValue>{t.event?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {d.events.map((e) => (
                <SelectItem key={e.code} value={e.code}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="truncate text-lg font-semibold">{t.event?.name}</div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {status && <Badge variant={status.variant}>{status.label}</Badge>}
          {code && <span className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{code}</span>}
        </div>
      </div>

      {/* Our rank and record */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          <Trophy className="h-3.5 w-3.5" /> Our rank
          {t.ourNumber !== null && <span className="tabular-nums"> · FTC {t.ourNumber}</span>}
        </div>
        {t.first.loading ? (
          <Shimmer className="h-9 w-32" />
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums tracking-tight">{t.ourRanking ? `#${t.ourRanking.rank}` : "-"}</span>
            <span className="text-lg tabular-nums text-[var(--muted-foreground)]">{formatRecord(t.record)}</span>
          </div>
        )}
        <div className="text-xs text-[var(--muted-foreground)]">
          {t.first.loading ? "Loading official data…" : t.ourRanking ? `W-L-T · of ${t.fieldSize} teams` : t.first.error ? "Official rankings couldn't be loaded" : "Official rankings aren't published yet"}
        </div>
      </div>

      {/* Next match */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          <CalendarClock className="h-3.5 w-3.5" /> Our next match
        </div>
        {t.first.loading ? (
          <Shimmer className="h-9 w-40" />
        ) : next ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-sm font-semibold">{next.label}</span>
              <AllianceChip color={next.alliance} />
              {next.partner !== null && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  with <TeamLink teamNumber={next.partner} eventCode={code} className="text-xs text-[var(--foreground)]" />
                </span>
              )}
            </div>
            <Countdown startMs={next.startMs} timeZone={t.timeZone} />
          </>
        ) : (
          <div className="text-sm text-[var(--muted-foreground)]">
            {t.ourNumber === null ? "Our team number isn't set." : t.first.error && t.ourMatches.length === 0 ? "The schedule couldn't be loaded." : t.ourMatches.length === 0 ? "No matches scheduled for us yet." : "All of our scheduled matches are played."}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

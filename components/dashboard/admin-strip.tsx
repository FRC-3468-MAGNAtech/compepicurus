"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DatabaseBackup, Flag, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Shimmer } from "@/components/ui/shimmer";
import { useLastBackup, useTeamCreationEnabled } from "@/lib/dashboard/admin";
import { useDashboard } from "@/lib/dashboard/data";
import { countFlaggedSessions } from "@/lib/dashboard/insights";
import { cn } from "@/lib/utils";

/**
 * A small strip only admins see: when the last backup was taken, how many
 * practice sessions have an unreviewed flag, and whether team creation is on.
 * It is only ever mounted for admins, so non-admins never run its queries (and
 * `auditLog` is admin-read-only in the rules regardless).
 */
export function AdminStrip() {
  const d = useDashboard();
  const { lastMs, loaded: backupLoaded } = useLastBackup(d.teamId);
  const creation = useTeamCreationEnabled();
  const flagged = useMemo(() => countFlaggedSessions(d.sessions), [d.sessions]);

  const backupLabel = !backupLoaded ? null : lastMs === null ? "Never" : new Date(lastMs).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="glass-pill flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 text-xs" role="region" aria-label="Admin">
      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
        Admin
      </Badge>

      <Link href="/admin" className="flex min-h-9 items-center gap-2 rounded-full pr-1 transition-colors hover:text-[var(--foreground)]" title="Admin Panel > Backups">
        <DatabaseBackup className="h-4 w-4 text-[var(--muted-foreground)]" />
        <span className="text-[var(--muted-foreground)]">Last backup</span>
        {backupLabel === null ? <Shimmer className="h-4 w-20" /> : <strong className={cn(lastMs === null && "text-amber-300")}>{backupLabel}</strong>}
      </Link>

      <Link href="/admin" className="flex min-h-9 items-center gap-2 rounded-full pr-1 transition-colors hover:text-[var(--foreground)]" title="Admin Panel > Sessions">
        <Flag className="h-4 w-4 text-[var(--muted-foreground)]" />
        <span className="text-[var(--muted-foreground)]">Flagged practice sessions</span>
        {!d.sessionsLoaded ? <Shimmer className="h-4 w-6" /> : <strong className={cn("tabular-nums", flagged > 0 && "text-amber-300")}>{flagged}</strong>}
      </Link>

      <Link href="/admin" className="flex min-h-9 items-center gap-2 rounded-full pr-1 transition-colors hover:text-[var(--foreground)]" title="Admin Panel (owners can change this)">
        <UserPlus className="h-4 w-4 text-[var(--muted-foreground)]" />
        <span className="text-[var(--muted-foreground)]">Team creation</span>
        {creation === null ? <Shimmer className="h-4 w-8" /> : <Badge variant={creation ? "warning" : "success"} className="text-[10px]">{creation ? "On" : "Off"}</Badge>}
      </Link>
    </div>
  );
}

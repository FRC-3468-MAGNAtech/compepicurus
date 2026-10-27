"use client";

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useTeamMembers } from "@/lib/team-members";
import { useAuditLog, type AuditAction, type AuditLogEntry } from "@/lib/audit-log";

const ACTION_LABELS: Record<AuditAction, string> = {
  "hard-reset-scout-data": "Hard Reset Scout Data",
  "dismiss-flag": "Dismiss Flag",
  "exclude-session": "Exclude Session",
  "include-session": "Include Session",
  "edit-entry": "Edit Entry",
  "rescore-event": "Rescore Event",
  "rescore-sessions": "Rescore Sessions",
  "refresh-official-scores": "Refresh Official Scores",
  "export-backup": "Export Backup",
};

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function formatDate(value: unknown): string {
  const ms = toMillis(value);
  if (!ms) return "pending…";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AuditLogPanel() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { entries } = useAuditLog(teamId);
  const { members } = useTeamMembers(teamId);

  const [actorFilter, setActorFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actorFilter !== "all" && e.uid !== actorFilter) return false;
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (q && !JSON.stringify(e.target).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, actorFilter, actionFilter, search]);

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="flex flex-wrap items-center gap-3">
        <Select value={actorFilter} onValueChange={setActorFilter}>
          <SelectTrigger className="w-44">
            <SelectValue>{actorFilter === "all" ? "All actors" : members.find((m) => m.uid === actorFilter)?.name ?? "Actor"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.uid} value={m.uid}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as AuditAction | "all")}>
          <SelectTrigger className="w-52">
            <SelectValue>{actionFilter === "all" ? "All actions" : ACTION_LABELS[actionFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {(Object.keys(ACTION_LABELS) as AuditAction[]).map((a) => (
              <SelectItem key={a} value={a}>
                {ACTION_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search session/entry id..." className="max-w-xs" />

        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{filtered.length} entries</span>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No audit log entries match these filters.</p>
        ) : (
          filtered.slice(0, 300).map((e) => <AuditRow key={e.id} entry={e} expanded={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} />)
        )}
      </GlassPanel>
    </div>
  );
}

function AuditRow({ entry, expanded, onToggle }: { entry: AuditLogEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="glass-card flex flex-col gap-2 p-3">
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-2 text-left">
        <Badge variant="glass" className="text-[10px]">
          {ACTION_LABELS[entry.action] ?? entry.action}
        </Badge>
        <span className="text-sm font-medium">{entry.actorName}</span>
        <span className="text-xs text-[var(--muted-foreground)]">{formatDate(entry.createdAt)}</span>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{expanded ? "Hide" : "Details"}</span>
      </button>
      {expanded && (
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <pre className="glass-overlay overflow-x-auto rounded-lg p-2">{JSON.stringify(entry.target, null, 2)}</pre>
          <pre className="glass-overlay overflow-x-auto rounded-lg p-2">{JSON.stringify(entry.before, null, 2)}</pre>
          <pre className="glass-overlay overflow-x-auto rounded-lg p-2">{JSON.stringify(entry.after, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

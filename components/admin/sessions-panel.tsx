"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Pencil, Search, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EntryEditDialog } from "@/components/admin/entry-edit-dialog";
import { useAuth } from "@/lib/auth";
import { useTeamMembers } from "@/lib/team-members";
import { getSeason, SEASONS } from "@/lib/seasons";
import { getPercentColor } from "@/lib/accuracy/engine";
import { dismissSessionFlag, hardResetScoutData, setSessionExcluded } from "@/lib/scout-stats/actions";
import { getEntriesForSession, type ScoutEntry } from "@/lib/scout-entries";
import { getPracticeSession, useAllTeamPracticeSessions, type PracticeSession, type SessionMode } from "@/lib/practice-sessions";

type KindFilter = "all" | "solo" | "live" | "lobby";
type ModeFilter = "all" | "trial" | "competitive";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SessionsPanel() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { sessions: allSessions } = useAllTeamPracticeSessions(teamId);
  const { members } = useTeamMembers(teamId);

  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<PracticeSession | null | undefined>(undefined);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [scoutFilter, setScoutFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const [detailSession, setDetailSession] = useState<PracticeSession | null>(null);

  const handleLookup = async () => {
    if (!lookupId.trim()) return;
    setLookupError(null);
    const result = await getPracticeSession(lookupId.trim());
    setLookupResult(result);
    if (!result) setLookupError(`No session with id "${lookupId.trim()}".`);
    else setDetailSession(result);
  };

  const filtered = useMemo(() => {
    return allSessions
      .filter((s) => scoutFilter === "all" || s.uid === scoutFilter)
      .filter((s) => kindFilter === "all" || s.kind === kindFilter)
      .filter((s) => modeFilter === "all" || s.mode === modeFilter)
      .filter((s) => !flaggedOnly || s.flags.some((f) => !f.dismissed))
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }, [allSessions, scoutFilter, kindFilter, modeFilter, flaggedOnly]);

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Look up by Session ID</label>
          <div className="mt-1 flex gap-2">
            <Input
              value={lookupId}
              onChange={(e) => {
                setLookupId(e.target.value);
                setLookupResult(undefined);
                setLookupError(null);
              }}
              placeholder="PS-XXXXXX / LV-XXXXXX / LB-XXXXXX"
            />
            <Button variant="glass" className="gap-2 shrink-0" onClick={handleLookup}>
              <Search className="h-4 w-4" /> Look up
            </Button>
          </div>
          {lookupError && <p className="mt-1 text-xs text-red-400">{lookupError}</p>}
          {lookupResult === null && !lookupError && <p className="mt-1 text-xs text-[var(--muted-foreground)]">Not found.</p>}
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-wrap items-center gap-3">
        <Select value={scoutFilter} onValueChange={setScoutFilter}>
          <SelectTrigger className="w-44">
            <SelectValue>{scoutFilter === "all" ? "All scouts" : members.find((m) => m.uid === scoutFilter)?.name ?? "Scout"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scouts</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.uid} value={m.uid}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as KindFilter)}>
          <SelectTrigger className="w-32">
            <SelectValue>{kindFilter === "all" ? "All kinds" : kindFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="solo">Solo</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="lobby">Lobby</SelectItem>
          </SelectContent>
        </Select>

        <Select value={modeFilter} onValueChange={(v) => setModeFilter(v as ModeFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue>{modeFilter === "all" ? "Trial + Competitive" : modeFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Trial + Competitive</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="competitive">Competitive</SelectItem>
          </SelectContent>
        </Select>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          Has active flags only
        </label>

        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{filtered.length} sessions</span>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No sessions match these filters.</p>
        ) : (
          filtered.slice(0, 200).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDetailSession(s)}
              className="glass-card flex flex-wrap items-center gap-3 p-3 text-left hover:bg-white/8"
            >
              <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{s.id}</span>
              <Badge variant="glass" className="text-[10px] uppercase">
                {s.kind}
              </Badge>
              <span className="text-sm font-medium">{s.scoutName}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{s.mode ?? "—"}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{formatDate(s.startedAt)}</span>
              {s.flags.some((f) => !f.dismissed) && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
              <span className={`ml-auto font-semibold tabular-nums ${s.accuracy !== null ? getPercentColor(s.accuracy) : ""}`}>
                {s.accuracy === null ? "?" : `${Math.round(s.accuracy)}%`}
              </span>
            </button>
          ))
        )}
        {filtered.length > 200 && (
          <p className="text-center text-xs text-[var(--muted-foreground)]">Showing the first 200 — narrow the filters for more.</p>
        )}
      </GlassPanel>

      {teamId && user && profile && (
        <SessionDetailDialog
          session={detailSession}
          open={detailSession !== null}
          onOpenChange={(open) => !open && setDetailSession(null)}
          teamId={teamId}
          actorUid={user.uid}
          actorName={profile.name}
          allSessionsForScout={detailSession ? allSessions.filter((s) => s.uid === detailSession.uid) : []}
        />
      )}
    </div>
  );
}

function SessionDetailDialog({
  session,
  open,
  onOpenChange,
  teamId,
  actorUid,
  actorName,
  allSessionsForScout,
}: {
  session: PracticeSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  actorUid: string;
  actorName: string;
  allSessionsForScout: PracticeSession[];
}) {
  const [entries, setEntries] = useState<ScoutEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<ScoutEntry | null>(null);

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      return;
    }
    let cancelled = false;
    getEntriesForSession(teamId, session.id).then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session, teamId]);

  if (!session) return null;
  const seasonName = SEASONS.some((s) => s.id === session.seasonId) ? getSeason(session.seasonId).name : session.seasonId;

  const handleDismissFlag = async (flagType: string) => {
    setBusy(true);
    try {
      await dismissSessionFlag(teamId, actorUid, actorName, session, flagType);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleExcluded = async () => {
    setBusy(true);
    try {
      await setSessionExcluded(teamId, actorUid, actorName, session, !session.excluded);
    } finally {
      setBusy(false);
    }
  };

  const handleHardReset = async () => {
    if (session.kind !== "solo" || !session.mode) return;
    setBusy(true);
    try {
      await hardResetScoutData(teamId, actorUid, actorName, session.uid, session.scoutName, session.mode as Exclude<SessionMode, null>, allSessionsForScout);
      setConfirmResetOpen(false);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(95vw,640px)] max-h-[85vh] overflow-y-auto">
          <DialogTitle className="font-mono">{session.id}</DialogTitle>
          <DialogDescription>
            {session.scoutName} &bull; {seasonName} &bull; {session.mode ?? "—"} {session.difficulty ? `· ${session.difficulty}` : ""}
          </DialogDescription>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Kind" value={session.kind} />
            <Stat label="Status" value={session.status} />
            <Stat
              label="Accuracy"
              value={session.accuracy === null ? "?" : `${Math.round(session.accuracy)}%`}
              accentClass={session.accuracy !== null ? getPercentColor(session.accuracy) : undefined}
            />
            <Stat label="Platform" value={session.platform} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat
              label="Match"
              value={session.matchType && session.matchNumber !== null ? `${session.matchType} ${session.matchNumber}` : session.libraryMatchId ?? "—"}
            />
            <Stat label="Alliance" value={session.alliance ?? "—"} />
            <Stat label="Robots" value={session.robots.join(", ") || "—"} />
            <Stat label="Scouted / Official / Penalty" value={`${session.scoutedTotal ?? "?"} / ${session.officialScore ?? "?"} / ${session.penaltyPoints ?? "?"}`} />
            <Stat label="Started" value={formatDate(session.startedAt)} />
            <Stat label="Finished" value={formatDate(session.finishedAt)} />
            {session.lobbyId && <Stat label="Lobby / Pair" value={`${session.lobbyId} / ${session.pairId ?? "—"}`} />}
          </div>

          {session.flags.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Flags</h3>
              <div className="flex flex-wrap gap-1.5">
                {session.flags.map((f) => (
                  <span
                    key={f.type}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                      f.dismissed ? "bg-white/8 text-[var(--muted-foreground)] line-through" : "bg-amber-500/15 text-amber-300"
                    }`}
                    title={f.detail}
                  >
                    <AlertTriangle className="h-3 w-3" /> {f.title}
                    {!f.dismissed && (
                      <button type="button" disabled={busy} onClick={() => handleDismissFlag(f.type)} className="ml-0.5 underline underline-offset-2">
                        Dismiss
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Entries ({entries.length})</h3>
            {entries.map((e) => (
              <div key={e.id} className="glass-card flex flex-wrap items-center gap-2 p-2.5 text-sm">
                <span className="font-medium">Team {e.teamNumber}</span>
                <span className="text-xs text-[var(--muted-foreground)]">Score {e.score.total}</span>
                <span className={`text-xs ${e.excluded ? "text-red-300" : "text-[var(--muted-foreground)]"}`}>{e.excluded ? "Excluded" : ""}</span>
                <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={() => setEditEntry(e)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--glass-border)] pt-4">
            <Button variant="ghost" size="sm" className="gap-1.5" disabled={busy} onClick={handleToggleExcluded}>
              {session.excluded ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {session.excluded ? "Include In Stats" : "Exclude From Stats"}
            </Button>
            {session.kind === "solo" && (
              <Button variant="danger" size="sm" className="gap-2" onClick={() => setConfirmResetOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Hard Reset This Scout&apos;s {session.mode} Data
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <EntryEditDialog
        entry={editEntry}
        open={editEntry !== null}
        onOpenChange={(open) => !open && setEditEntry(null)}
        teamId={teamId}
        actorUid={actorUid}
        actorName={actorName}
        onSaved={() => getEntriesForSession(teamId, session.id).then(setEntries)}
      />

      <Dialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <DialogContent>
          <DialogTitle>
            Hard reset {session.scoutName}&apos;s {session.mode} data?
          </DialogTitle>
          <DialogDescription>
            This permanently deletes every completed {session.mode} session (and its scout entries) for {session.scoutName}. This
            can&apos;t be undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={handleHardReset}>
              {busy ? "Resetting…" : "Hard Reset"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, accentClass }: { label: string; value: string; accentClass?: string }) {
  return (
    <div className="glass-card flex flex-col gap-1 p-3">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <span className={`text-sm font-semibold ${accentClass ?? ""}`}>{value}</span>
    </div>
  );
}

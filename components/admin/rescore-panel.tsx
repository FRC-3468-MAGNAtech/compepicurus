"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { SEASONS, getSeason, DEFAULT_SEASON_ID } from "@/lib/seasons";
import { getMatchesForEvent } from "@/lib/ftc/actions";
import { importLibraryEvent, useAllLibraryMatches } from "@/lib/match-library";
import { useAllTeamPracticeSessions } from "@/lib/practice-sessions";
import { useTeamScoutEntries } from "@/lib/scout-entries";
import { logAuditEvent } from "@/lib/audit-log";
import { applyEventRescorePlan, computeEventRescorePlan, eventRescorePatchChanges, type EventRescorePatch } from "@/lib/analytics/recompute";
import {
  applySessionRescorePlan,
  buildSessionRescorePlan,
  sessionRescorePatchChanges,
  type SessionRescoreFilter,
  type SessionRescorePatch,
} from "@/lib/admin/rescore-sessions";
import type { FtcMatch } from "@/lib/ftc/types";

type Category = "event" | "sessions";

export function RescorePanel() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const [category, setCategory] = useState<Category>("event");

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={category} onValueChange={(v) => setCategory(v as Category)}>
        <TabsList>
          <TabsTrigger value="event">Real Event Entries</TabsTrigger>
          <TabsTrigger value="sessions">Practice / Live / Lobby Sessions</TabsTrigger>
        </TabsList>
      </Tabs>

      {teamId && user && profile && (
        category === "event" ? (
          <EventRescore teamId={teamId} actorUid={user.uid} actorName={profile.name} />
        ) : (
          <SessionRescore teamId={teamId} actorUid={user.uid} actorName={profile.name} />
        )
      )}
    </div>
  );
}

function EventRescore({ teamId, actorUid, actorName }: { teamId: string; actorUid: string; actorName: string }) {
  const [seasonId, setSeasonId] = useState(DEFAULT_SEASON_ID);
  const [eventCode, setEventCode] = useState("");
  const [plan, setPlan] = useState<EventRescorePatch[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  const season = getSeason(seasonId);
  const changed = plan?.filter(eventRescorePatchChanges) ?? [];

  const handlePreview = async () => {
    if (!eventCode.trim()) return;
    setPreviewing(true);
    setError(null);
    setAppliedCount(null);
    try {
      setPlan(await computeEventRescorePlan(teamId, eventCode.trim(), season.apiSeason));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't compute a rescore plan.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      await applyEventRescorePlan(plan);
      await logAuditEvent(teamId, actorUid, actorName, "rescore-event", { eventCode: eventCode.trim(), season: season.apiSeason }, null, {
        entryCount: plan.length,
        changedCount: changed.length,
      });
      setAppliedCount(plan.length);
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply the rescore.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="rescore-season">Season</Label>
          <Select value={seasonId} onValueChange={setSeasonId}>
            <SelectTrigger id="rescore-season">
              <SelectValue>{season.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SEASONS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="rescore-event-code">Event code</Label>
          <Input id="rescore-event-code" value={eventCode} onChange={(e) => setEventCode(e.target.value.toUpperCase())} placeholder="USWABON1" />
        </div>
      </div>

      <Button className="gap-2 self-start" disabled={!eventCode.trim() || previewing} onClick={handlePreview}>
        <RefreshCw className={previewing ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> {previewing ? "Computing…" : "Preview Rescore"}
      </Button>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {appliedCount !== null && <p className="text-sm text-emerald-400">Applied — rescored {appliedCount} entries.</p>}

      {plan && (
        <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-4">
          <p className="text-sm">
            <strong>{changed.length}</strong> of {plan.length} entries would change.
          </p>
          {changed.length > 0 && (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {changed.slice(0, 100).map((p) => (
                <div key={p.entryId} className="glass-card flex items-center gap-2 p-2 text-xs">
                  <Badge variant="glass" className="font-mono">
                    {p.matchLabel}
                  </Badge>
                  <span>Team {p.teamNumber}</span>
                  <span className="ml-auto tabular-nums text-[var(--muted-foreground)]">
                    {p.before.value === null ? "?" : `${Math.round(p.before.value * 100)}%`} &rarr;{" "}
                    {p.after.value === null ? "?" : `${Math.round(p.after.value * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          )}
          <Button variant="danger" disabled={applying} onClick={handleApply} className="self-start">
            {applying ? "Applying…" : `Apply to ${plan.length} entries`}
          </Button>
        </div>
      )}
    </GlassPanel>
  );
}

function SessionRescore({ teamId, actorUid, actorName }: { teamId: string; actorUid: string; actorName: string }) {
  const { sessions } = useAllTeamPracticeSessions(teamId);
  const { entries } = useTeamScoutEntries(teamId);
  const { matches: libraryMatches } = useAllLibraryMatches();

  const [seasonId, setSeasonId] = useState<string>("all");
  const [eventCode, setEventCode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refreshSeasonId, setRefreshSeasonId] = useState(DEFAULT_SEASON_ID);
  const [refreshEventCode, setRefreshEventCode] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  const [plan, setPlan] = useState<SessionRescorePatch[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  const libraryMatchesById = new Map(libraryMatches.map((m) => [m.id, m]));
  const changed = plan?.filter(sessionRescorePatchChanges) ?? [];

  const handleRefreshOfficialScores = async () => {
    if (!refreshEventCode.trim()) return;
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const summary = await importLibraryEvent(refreshSeasonId, refreshEventCode.trim());
      setRefreshResult(`${summary.eventName}: refreshed ${summary.imported} matches, skipped ${summary.skipped}.`);
      await logAuditEvent(teamId, actorUid, actorName, "refresh-official-scores", { eventCode: refreshEventCode.trim() }, null, summary);
    } catch (err) {
      setRefreshResult(err instanceof Error ? err.message : "Couldn't refresh scores.");
    } finally {
      setRefreshing(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    setAppliedCount(null);
    try {
      const filter: SessionRescoreFilter = {
        seasonId: seasonId === "all" ? null : seasonId,
        eventCode: eventCode.trim() || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      };

      const liveCandidates = sessions.filter(
        (s) => s.status === "completed" && s.kind === "live" && s.eventCode && s.matchType && s.matchNumber !== null
      );
      const uniqueEventTypes = new Map<string, { eventCode: string; matchType: FtcMatch["type"] }>();
      for (const s of liveCandidates) uniqueEventTypes.set(`${s.eventCode}|${s.matchType}`, { eventCode: s.eventCode!, matchType: s.matchType! });

      const liveMatchesByKey = new Map<string, FtcMatch>();
      for (const { eventCode: code, matchType } of uniqueEventTypes.values()) {
        const season = seasonId === "all" ? getSeason() : getSeason(seasonId);
        const res = await getMatchesForEvent(code, matchType, season.apiSeason);
        if (res.ok) {
          for (const m of res.data) liveMatchesByKey.set(`${code}|${matchType}|${m.matchNumber}`, m);
        }
      }

      setPlan(buildSessionRescorePlan(sessions, entries, libraryMatchesById, liveMatchesByKey, filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't compute a rescore plan.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!plan) return;
    setApplying(true);
    setProgress(null);
    try {
      await applySessionRescorePlan(plan, (done, total) => setProgress({ done, total }));
      await logAuditEvent(teamId, actorUid, actorName, "rescore-sessions", { seasonId, eventCode, dateFrom, dateTo }, null, {
        groupCount: plan.length,
        changedCount: changed.length,
      });
      setAppliedCount(plan.length);
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply the rescore.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Refresh official scores for a library event</h3>
        <p className="text-xs text-[var(--muted-foreground)]">
          Re-imports the event&apos;s current scores from FIRST before rescoring solo/lobby sessions against it — the same idempotent import
          Admin Panel &gt; Match Library uses.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={refreshSeasonId} onValueChange={setRefreshSeasonId}>
            <SelectTrigger className="w-36">
              <SelectValue>{getSeason(refreshSeasonId).name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SEASONS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={refreshEventCode}
            onChange={(e) => setRefreshEventCode(e.target.value.toUpperCase())}
            placeholder="USWABON1"
            className="w-40"
          />
          <Button variant="glass" disabled={!refreshEventCode.trim() || refreshing} onClick={handleRefreshOfficialScores}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {refreshResult && <p className="text-xs text-[var(--muted-foreground)]">{refreshResult}</p>}
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Rescore sessions</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <Label>Season</Label>
            <Select value={seasonId} onValueChange={setSeasonId}>
              <SelectTrigger>
                <SelectValue>{seasonId === "all" ? "All seasons" : getSeason(seasonId).name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All seasons</SelectItem>
                {SEASONS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Event code (optional)</Label>
            <Input value={eventCode} onChange={(e) => setEventCode(e.target.value.toUpperCase())} placeholder="All events" />
          </div>
          <div>
            <Label>From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <Button className="gap-2 self-start" disabled={previewing} onClick={handlePreview}>
          <RefreshCw className={previewing ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> {previewing ? "Computing…" : "Preview Rescore"}
        </Button>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {appliedCount !== null && <p className="text-sm text-emerald-400">Applied — rescored {appliedCount} session group(s).</p>}

        {plan && (
          <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-4">
            <p className="text-sm">
              <strong>{changed.length}</strong> of {plan.length} session groups would change.
            </p>
            {changed.length > 0 && (
              <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {changed.slice(0, 100).map((p) => (
                  <div key={p.sessionIds.join("-")} className="glass-card flex flex-wrap items-center gap-2 p-2 text-xs">
                    <Badge variant="glass" className="text-[10px] uppercase">
                      {p.kind}
                    </Badge>
                    <Badge variant="glass" className="font-mono">
                      {p.matchLabel}
                    </Badge>
                    <span>{p.scoutNames.join(" & ")}</span>
                    <span className="ml-auto tabular-nums text-[var(--muted-foreground)]">
                      {p.before === null ? "?" : `${Math.round(p.before)}%`} &rarr; {p.after === null ? "?" : `${Math.round(p.after)}%`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Button variant="danger" disabled={applying} onClick={handleApply} className="self-start">
              {applying ? (progress ? `Applying… (${progress.done}/${progress.total})` : "Applying…") : `Apply to ${plan.length} group(s)`}
            </Button>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Lock, LockOpen, Shuffle, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { checkableTeams } from "@/lib/scout-status/form-status";
import { assignmentProgress, countsOf, distributeTeams, setTeamLocked, setTeamScouts, teamsForScout, unassignedTeams, type DistributeMode, type TeamAssignRow } from "@/lib/team-assignments/distribute";
import { randomSeed } from "@/lib/scheduler/rng";
import { TEAM_ASSIGN_KIND_INFO, type TeamAssignKind, type TeamAssignmentsDoc, type TeamAssignVersion } from "@/lib/team-assignments/model";
import { cn } from "@/lib/utils";

// P31: one Assignments tab for Pit Scouting or Team Strategy. TeamAssignmentsView is the pure screen (settings, preview/edit table, per-scout totals, publish and undo for
// someone who can edit; "my teams" for a scout); TeamAssignmentsPanel is wired to live data in team-assignments-connected.tsx.

export type ScoutOption = { uid: string; name: string; role: string | null; /** Can't open the form: they'd be assigned teams they can't scout. */ noAccess?: boolean };

export type TeamAssignmentsViewProps = {
  kind: TeamAssignKind;
  /** The event's teams (FIRST), with names. */
  teams: { teamNumber: number; name: string | null }[];
  isOurs: (team: number) => boolean;
  /** Attending members who can open the form (the default pool). */
  eligible: ScoutOption[];
  /** Everyone else on the team, for "Add any member". */
  others: ScoutOption[];
  published: TeamAssignmentsDoc | null;
  canEdit: boolean;
  me: string | null;
  /** Teams I (the signed-in person) have an entry for, for the read-only progress. */
  done: ReadonlySet<number>;
  nameOf: (uid: string) => string;
  publishing?: boolean;
  onPublish: (version: Omit<TeamAssignVersion, "generatedBy" | "generatedAt">) => void;
  onUndo: () => void;
};

const MODE_LABEL: Record<DistributeMode, string> = { "balanced-random": "Balanced random", "sequential-blocks": "Sequential blocks (by team number)" };

function parsePriority(text: string, valid: ReadonlySet<number>): number[] {
  return [...new Set(text.split(/[\s,]+/).map((t) => Number(t)).filter((n) => Number.isInteger(n) && valid.has(n)))];
}

export function TeamAssignmentsView(props: TeamAssignmentsViewProps) {
  const { kind, canEdit } = props;
  const info = TEAM_ASSIGN_KIND_INFO[kind];
  if (!canEdit) return <MyTeams {...props} />;
  return <Editor key={kind} {...props} info={info} />;
}

// --- the scout's own read-only view ---------------------------------------------------------------------------------

function MyTeams({ kind, published, me, done, teams }: TeamAssignmentsViewProps) {
  const info = TEAM_ASSIGN_KIND_INFO[kind];
  const mine = published?.current && me ? teamsForScout(published.current.teams, me) : [];
  const p = assignmentProgress(mine, done);
  const nameOf = new Map(teams.map((t) => [t.teamNumber, t.name]));
  return (
    <GlassPanel className="flex flex-col gap-3" data-testid={`my-teams-${kind}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Your {info.noun} teams</h2>
        {p.total > 0 && (
          <span className="text-sm tabular-nums" data-testid={`my-progress-${kind}`}>
            {p.done} of {p.total} done
          </span>
        )}
      </div>
      {!published?.current ? (
        <p className="text-sm text-[var(--muted-foreground)]">Nothing has been assigned yet.</p>
      ) : mine.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">You have no teams in this assignment.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {mine.map((t) => (
            <li key={t} data-testid={`my-team-${t}`} data-done={done.has(t) ? "true" : "false"} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", done.has(t) ? "border-emerald-400/40 bg-emerald-500/10" : "border-[var(--glass-border)]")} title={nameOf.get(t) ?? undefined}>
              <span className="font-semibold tabular-nums">{t}</span>
              {done.has(t) && <Check className="h-3.5 w-3.5 text-emerald-300" aria-label="Done" />}
            </li>
          ))}
        </ul>
      )}
      {mine.length > 0 && (
        <a href={info.href} className="text-sm text-[var(--color-primary)] hover:underline">
          Open the {info.tab} form
        </a>
      )}
    </GlassPanel>
  );
}

// --- the editor ---------------------------------------------------------------------------------------------------------

function Editor({ kind, teams, isOurs, eligible, others, published, nameOf, publishing, onPublish, onUndo, info }: TeamAssignmentsViewProps & { info: (typeof TEAM_ASSIGN_KIND_INFO)[TeamAssignKind] }) {
  const [includeOurs, setIncludeOurs] = useState(false);
  const [mode, setMode] = useState<DistributeMode>("balanced-random");
  const [coverage, setCoverage] = useState<1 | 2>(2);
  const [priorityText, setPriorityText] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<ScoutOption[]>([]);
  const [addPick, setAddPick] = useState("");
  const [draft, setDraft] = useState<{ rows: TeamAssignRow[]; seed: number } | null>(null);

  const pool = useMemo(() => [...eligible.filter((s) => !excluded.has(s.uid)), ...extras.filter((s) => !excluded.has(s.uid))], [eligible, extras, excluded]);
  const poolUids = useMemo(() => pool.map((s) => s.uid), [pool]);
  const numbers = useMemo(() => checkableTeams(teams.map((t) => t.teamNumber), isOurs, includeOurs), [teams, isOurs, includeOurs]);
  const validTeams = useMemo(() => new Set(numbers), [numbers]);
  const priority = useMemo(() => parsePriority(priorityText, validTeams), [priorityText, validTeams]);
  const teamName = useMemo(() => new Map(teams.map((t) => [t.teamNumber, t.name])), [teams]);
  const addable = others.filter((o) => !extras.some((e) => e.uid === o.uid) && !eligible.some((e) => e.uid === o.uid));

  const roll = (fresh: boolean) => {
    const seed = fresh || !draft ? randomSeed() : draft.seed;
    const locked = (draft?.rows ?? []).filter((r) => r.locked);
    const r = distributeTeams({ teams: numbers, scoutUids: poolUids, mode, priorityTeams: priority, priorityCoverage: coverage, locked, seed });
    setDraft({ rows: r.rows, seed });
  };

  const counts = useMemo(() => (draft ? countsOf(draft.rows, poolUids) : {}), [draft, poolUids]);
  const values = Object.values(counts);
  const uneven = values.length > 0 && Math.max(...values) - Math.min(...values) > 1;
  const missing = draft ? unassignedTeams(draft.rows) : [];

  const publish = () => {
    if (!draft) return;
    onPublish({ settings: { scoutUids: poolUids, priorityTeams: priority, priorityCoverage: coverage, mode, includeOurs, seed: draft.seed }, teams: draft.rows, counts, uneven, warning: uneven ? "Loads are uneven." : null });
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-4" data-testid={`team-assignments-${kind}`}>
      <GlassPanel className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{info.tab} assignments</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Hands the event&apos;s teams out to the scouts who can open the {info.tab} form. {numbers.length} teams to cover.</p>
          </div>
          <Button className="gap-2" onClick={() => roll(true)} disabled={pool.length === 0 || numbers.length === 0} data-testid="randomize">
            <Shuffle className="h-4 w-4" /> {draft ? "Re-roll" : "Randomize"}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`mode-${kind}`}>How to hand them out</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as DistributeMode)}>
              <SelectTrigger id={`mode-${kind}`}>
                <SelectValue>{MODE_LABEL[mode]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABEL) as DistributeMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`coverage-${kind}`}>Scouts on each priority team</Label>
            <Select value={String(coverage)} onValueChange={(v) => setCoverage(v === "1" ? 1 : 2)}>
              <SelectTrigger id={`coverage-${kind}`}>
                <SelectValue>{coverage}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`priority-${kind}`}>Priority teams (team numbers, separated by commas)</Label>
            <Input id={`priority-${kind}`} value={priorityText} onChange={(e) => setPriorityText(e.target.value)} placeholder="e.g. 1234, 5678" />
            {priority.length > 0 && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{priority.length} priority team{priority.length === 1 ? "" : "s"} in this event.</p>}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeOurs} onChange={(e) => setIncludeOurs(e.target.checked)} data-testid="include-ours" />
          Include our own teams
        </label>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">Scouts</div>
          {eligible.length === 0 && extras.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">Nobody who is attending can open the {info.tab} form yet. Mark attendance above, or add a member below.</p>}
          <ul className="flex flex-wrap gap-2" data-testid="scout-pool">
            {[...eligible, ...extras].map((s) => (
              <li key={s.uid}>
                <label className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm", excluded.has(s.uid) ? "border-[var(--glass-border)] opacity-50" : "border-[var(--color-primary)]")}>
                  <input type="checkbox" checked={!excluded.has(s.uid)} onChange={() => setExcluded((cur) => { const next = new Set(cur); if (next.has(s.uid)) next.delete(s.uid); else next.add(s.uid); return next; })} aria-label={s.name} />
                  {s.name}
                  {s.noAccess && <span className="text-[10px] text-amber-300" title="Can't open this form yet">no access</span>}
                </label>
              </li>
            ))}
          </ul>
          {addable.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={addPick} onValueChange={(uid) => { const m = others.find((o) => o.uid === uid); if (m) setExtras((cur) => [...cur, { ...m, noAccess: true }]); setAddPick(""); }}>
                <SelectTrigger className="w-64" aria-label="Add any member">
                  <SelectValue>Add any member…</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {addable.map((o) => (
                    <SelectItem key={o.uid} value={o.uid}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </GlassPanel>

      {draft && (
        <GlassPanel className="flex flex-col gap-3" data-testid="team-draft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="warning">Unpublished draft</Badge>
              {uneven && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-300" data-testid="uneven-warning">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Uneven: {Math.min(...values)} to {Math.max(...values)} teams each
                </span>
              )}
              {missing.length > 0 && <span className="text-xs text-amber-300" data-testid="unassigned-warning">{missing.length} team{missing.length === 1 ? "" : "s"} unassigned</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Discard
              </Button>
              <Button size="sm" disabled={publishing} onClick={publish} data-testid="publish">
                {publishing ? "Publishing…" : "Save / Publish"}
              </Button>
            </div>
          </div>

          <ul className="flex flex-wrap gap-2" data-testid="scout-totals">
            {pool.map((s) => (
              <li key={s.uid} data-testid={`total-${s.uid}`} className="rounded-full border border-[var(--glass-border)] px-3 py-1 text-xs">
                {s.name} <strong className="ml-1 tabular-nums">{counts[s.uid] ?? 0}</strong>
              </li>
            ))}
          </ul>

          <div className="max-h-[60vh] overflow-auto rounded-2xl border border-[var(--glass-border)]">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="sticky top-0 bg-[var(--background)] text-left text-xs text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Team</th>
                  <th className="px-3 py-2 font-medium">Scout</th>
                  <th className="px-3 py-2 font-medium">Second scout</th>
                  <th className="px-3 py-2 font-medium">Keep</th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((r) => (
                  <tr key={r.teamNumber} className="border-t border-[var(--glass-border)]" data-testid={`team-row-${r.teamNumber}`} data-locked={r.locked ? "true" : "false"}>
                    <td className="px-3 py-1.5">
                      <span className="font-semibold tabular-nums">{r.teamNumber}</span>
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">{teamName.get(r.teamNumber) ?? ""}</span>
                      {priority.includes(r.teamNumber) && <span className="ml-2 rounded bg-amber-500/20 px-1 text-[10px] uppercase text-amber-200">Priority</span>}
                    </td>
                    {[0, 1].map((slot) => (
                      <td key={slot} className="px-3 py-1.5">
                        <select
                          aria-label={`${slot === 0 ? "Scout" : "Second scout"} for team ${r.teamNumber}`}
                          value={r.scoutUids[slot] ?? ""}
                          onChange={(e) => {
                            const next = [...r.scoutUids];
                            if (e.target.value === "") next.splice(slot, 1);
                            else next[slot] = e.target.value;
                            setDraft({ ...draft, rows: setTeamScouts(draft.rows, r.teamNumber, next.filter(Boolean)) });
                          }}
                          className="h-9 w-full rounded-xl border border-[var(--glass-border)] bg-white/5 px-2 text-sm [&>option]:bg-[#1b1b26] [&>option]:text-white"
                        >
                          <option value="">{slot === 0 ? "Unassigned" : "—"}</option>
                          {pool.filter((s) => s.uid !== r.scoutUids[1 - slot]).map((s) => (
                            <option key={s.uid} value={s.uid}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td className="px-3 py-1.5">
                      <button type="button" onClick={() => setDraft({ ...draft, rows: setTeamLocked(draft.rows, r.teamNumber, !r.locked) })} aria-pressed={r.locked} aria-label={`${r.locked ? "Unlock" : "Lock"} team ${r.teamNumber}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                        {r.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">Changing a team by hand locks it, so Re-roll keeps it. Unlock it to let a re-roll move it.</p>
        </GlassPanel>
      )}

      {published?.current && !draft && (
        <GlassPanel className="flex flex-col gap-3" data-testid="team-published">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">Published {new Date(published.current.generatedAt).toLocaleString()}</span>
            <div className="flex gap-2">
              <Button variant="glass" size="sm" onClick={() => setDraft({ rows: published.current!.teams.map((r) => ({ ...r, locked: true })), seed: published.current!.settings.seed })} data-testid="edit-published">
                Edit as a draft
              </Button>
              {published.previous && (
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={onUndo} data-testid="undo">
                  <Undo2 className="h-3.5 w-3.5" /> Undo to previous version
                </Button>
              )}
            </div>
          </div>
          <ul className="flex flex-wrap gap-2" data-testid="published-totals">
            {Object.entries(countsOf(published.current.teams, [...new Set(published.current.teams.flatMap((r) => r.scoutUids))])).map(([uid, n]) => (
              <li key={uid} className="rounded-full border border-[var(--glass-border)] px-3 py-1 text-xs">
                {nameOf(uid)} <strong className="ml-1 tabular-nums">{n}</strong>
              </li>
            ))}
          </ul>
          <div className="max-h-[50vh] overflow-auto rounded-2xl border border-[var(--glass-border)]">
            <table className="w-full min-w-[420px] text-sm">
              <tbody>
                {published.current.teams.map((r) => (
                  <tr key={r.teamNumber} className="border-t border-[var(--glass-border)] first:border-t-0">
                    <td className="px-3 py-1.5 font-semibold tabular-nums">{r.teamNumber}</td>
                    <td className="px-3 py-1.5">{r.scoutUids.length === 0 ? <span className="text-[var(--muted-foreground)]">Unassigned</span> : r.scoutUids.map(nameOf).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}
      {!published?.current && !draft && <p className="text-sm text-[var(--muted-foreground)]">No assignment published yet for this event.</p>}
    </div>
  );
}

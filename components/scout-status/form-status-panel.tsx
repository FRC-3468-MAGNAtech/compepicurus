"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Lock } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { useAnalyticsData } from "@/lib/analytics/data-context";
import { useEventTeams } from "@/lib/analytics/use-event-data";
import { useAuth } from "@/lib/auth";
import { useTeamEventAttendance } from "@/lib/event-attendance";
import { useFormEntries } from "@/lib/form-entries";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { canAccessPage } from "@/lib/page-access/access";
import { usePageAccess } from "@/lib/page-access/store";
import { getRole } from "@/lib/roles";
import { playedFractionOf, sumTargets, type EventContext, type ScoutStatusPill, type ScoutDescriptor, type CategoryRecord, type TargetCell } from "@/lib/scout-status/compute";
import { allianceCoverage, allianceScoutRows, allianceUnits, checkableTeams, eligibleFormScouts, helperCountRows, statusEntries, teamCoverage, teamScoutRows, type AllianceCoverage, type AllianceScoutRow, type HelperCountRow, type TeamCoverageRow, type TeamScoutRow, type TeamTargetSetup } from "@/lib/scout-status/form-status";
import type { ScoutStatusFormType } from "@/lib/scout-status/form-types";
import { saveScoutTargets } from "@/lib/scout-status/store";
import type { EventSetupView } from "@/lib/scout-status/use-scout-status";
import { cn } from "@/lib/utils";

// P30: Scout Status for the other form types. FormStatusView is the pure screen; FormStatusPanel feeds it live data. Accuracy columns are absent: none of these forms
// is scored.

const PILL: Record<ScoutStatusPill, { label: string; className: string }> = {
  behind: { label: "Behind", className: "bg-red-500/15 text-red-300 border border-red-400/30" },
  "not-started": { label: "Not started", className: "bg-slate-500/20 text-slate-300 border border-slate-400/30" },
  "on-track": { label: "On track", className: "bg-sky-500/15 text-sky-300 border border-sky-400/30" },
  "no-target": { label: "No target", className: "bg-white/8 text-[var(--muted-foreground)] border border-[var(--glass-border)]" },
  complete: { label: "Complete", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30" },
};

function Pill({ status }: { status: ScoutStatusPill }) {
  const p = PILL[status];
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", p.className)}>{p.label}</span>;
}

const ago = (ms: number | null, now: number) => {
  if (ms === null) return "—";
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

export type FormStatusViewProps = {
  type: ScoutStatusFormType;
  now: number;
  /** More than one event: a column says which. */
  multiEvent: boolean;
  alliance?: { rows: AllianceScoutRow[]; coverage: AllianceCoverage[] };
  team?: {
    rows: TeamScoutRow[];
    coverage: TeamCoverageRow[];
    includeOurs: boolean;
    onIncludeOurs: (v: boolean) => void;
    isOurs: (team: number) => boolean;
    /** The single "teams per scout" number, editable while exactly one event is shown. */
    all: number | null;
    canEdit: boolean;
    onSetAll: (n: number | null) => void;
    onSetIndividual: (uid: string, n: number | null) => void;
  };
  helper?: HelperCountRow[];
};

export function FormStatusView({ type, now, multiEvent, alliance, team, helper }: FormStatusViewProps) {
  return (
    <div className="flex flex-col gap-5" data-testid={`form-status-${type.id}`}>
      <p className="text-xs text-[var(--muted-foreground)]">
        {type.scoutedUnit}. {type.unit === "match-alliance" ? "Accuracy doesn't apply here: nothing is scored." : type.unit === "team" ? "Each team counts once however many scouts did it." : "Counted per person."}
      </p>

      {alliance && <AllianceStatus type={type} now={now} multiEvent={multiEvent} rows={alliance.rows} coverage={alliance.coverage} />}
      {team && <TeamStatus type={type} now={now} {...team} />}
      {helper && <HelperStatus rows={helper} now={now} />}
    </div>
  );
}

// --- alliance types ---------------------------------------------------------------------------------------------

function AllianceStatus({ type, now, multiEvent, rows, coverage }: { type: ScoutStatusFormType; now: number; multiEvent: boolean; rows: AllianceScoutRow[]; coverage: AllianceCoverage[] }) {
  const done = coverage.filter((c) => c.done).length;
  const reflection = type.id === "drive-reflection";
  const gaps = coverage.filter((c) => c.planWithoutReflection).length;
  return (
    <>
      <GlassPanel className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Alliances scouted</div>
          <div className="text-2xl font-semibold tabular-nums" data-testid="alliances-done">
            {done} <span className="text-base font-normal text-[var(--muted-foreground)]">of {coverage.length}</span>
          </div>
        </div>
        {reflection && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Planned, not reflected on</div>
            <div className="text-2xl font-semibold tabular-nums" data-testid="plan-gaps">{gaps}</div>
          </div>
        )}
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Scout status table</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="py-1 pr-3 font-medium">Scout</th>
                <th className="py-1 pr-3 font-medium">Alliances</th>
                <th className="py-1 pr-3 font-medium">Entries</th>
                <th className="py-1 pr-3 font-medium">Target</th>
                <th className="py-1 pr-3 font-medium">Last entry</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid} className="border-t border-[var(--glass-border)]" data-testid={`status-row-${r.uid}`}>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.name}</div>
                    {r.role && <div className="text-xs text-[var(--muted-foreground)]">{r.role}</div>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{r.alliances}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.entries}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.target ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs">{r.lastEntry ? `${r.lastEntry.label}${multiEvent ? ` · ${r.lastEntry.eventCode}` : ""} · ${ago(r.lastEntry.atMs, now)}` : "—"}</td>
                  <td className="py-2">
                    <Pill status={r.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[var(--muted-foreground)]">
                    Nobody is listed yet: mark who is attending in Assignments.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Match coverage</h3>
        {coverage.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No matches in range yet.</p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2" data-testid="alliance-coverage">
            {pairUp(coverage).map(([red, blue]) => (
              <li key={(red ?? blue)!.unit.key.replace(/\|(red|blue)$/, "")} className="flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-sm">
                <span className="w-14 font-mono text-xs font-semibold">
                  {(red ?? blue)!.unit.label}
                  {multiEvent && <span className="block text-[10px] font-normal text-[var(--muted-foreground)]">{(red ?? blue)!.unit.eventCode}</span>}
                </span>
                {[red, blue].map((c, i) =>
                  c ? (
                    <span key={i} data-testid={`cov-${c.unit.matchKey}-${c.unit.alliance}`} data-done={c.done ? "true" : "false"} data-plan-gap={c.planWithoutReflection ? "true" : "false"} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", c.unit.alliance === "red" ? "bg-red-500/10 text-red-200" : "bg-sky-500/10 text-sky-200")}>
                      {c.unit.alliance === "red" ? "Red" : "Blue"}
                      {c.done ? <Check className="h-3.5 w-3.5 text-emerald-300" aria-label="Scouted" /> : <span className="text-[var(--muted-foreground)]" aria-label="Not scouted">·</span>}
                      {c.planWithoutReflection && <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-label="Planned, no reflection yet" />}
                      {reflection && c.done && c.differences > 0 && (
                        <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-200" data-testid={`diff-${c.unit.matchKey}-${c.unit.alliance}`}>
                          {c.differences} diff
                        </span>
                      )}
                    </span>
                  ) : null
                )}
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </>
  );
}

function pairUp(coverage: AllianceCoverage[]): [AllianceCoverage | null, AllianceCoverage | null][] {
  const pairs = new Map<string, [AllianceCoverage | null, AllianceCoverage | null]>();
  for (const c of coverage) {
    const k = c.unit.key.replace(/\|(red|blue)$/, "");
    const cur = pairs.get(k) ?? [null, null];
    if (c.unit.alliance === "red") cur[0] = c;
    else cur[1] = c;
    pairs.set(k, cur);
  }
  return [...pairs.values()];
}

// --- team types --------------------------------------------------------------------------------------------------

function TargetInput({ value, disabled, label, onCommit }: { value: number | null; disabled: boolean; label: string; onCommit: (n: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      inputMode="numeric"
      aria-label={label}
      disabled={disabled}
      className="h-9 w-20 text-center tabular-nums"
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
      onBlur={() => {
        if (draft !== null) onCommit(draft === "" ? null : Number(draft));
        setDraft(null);
      }}
    />
  );
}

function TeamStatus({ type, now, rows, coverage, includeOurs, onIncludeOurs, isOurs, all, canEdit, onSetAll, onSetIndividual }: { type: ScoutStatusFormType; now: number } & NonNullable<FormStatusViewProps["team"]>) {
  const done = coverage.filter((c) => c.done).length;
  const pit = type.id === "pit-scout";
  return (
    <>
      <GlassPanel className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Teams done</div>
          <div className="text-2xl font-semibold tabular-nums" data-testid="teams-done">
            {done} <span className="text-base font-normal text-[var(--muted-foreground)]">of {coverage.length}</span>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeOurs} onChange={(e) => onIncludeOurs(e.target.checked)} data-testid="include-ours" />
          Include our own teams
        </label>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-[var(--muted-foreground)]">Teams per scout (everyone)</span>
          <TargetInput value={all} disabled={!canEdit} label="Teams per scout, everyone" onCommit={onSetAll} />
          {!canEdit && <Lock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" aria-label="Read-only" />}
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Scout status table</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="py-1 pr-3 font-medium">Scout</th>
                <th className="py-1 pr-3 font-medium">Teams done</th>
                <th className="py-1 pr-3 font-medium">Target</th>
                <th className="py-1 pr-3 font-medium">Last entry</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid} className="border-t border-[var(--glass-border)]" data-testid={`status-row-${r.uid}`}>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.name}</div>
                    {r.role && <div className="text-xs text-[var(--muted-foreground)]">{r.role}</div>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{r.teams}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <TargetInput value={r.target.value} disabled={!canEdit} label={`Target for ${r.name}`} onCommit={(n) => onSetIndividual(r.uid, n)} />
                      {r.target.source === "assignments" && (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300" data-testid={`target-source-${r.uid}`}>
                          from assignments
                        </span>
                      )}
                      {r.target.source === "manual" && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]" data-testid={`target-source-${r.uid}`}>
                          manual
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-xs">{ago(r.lastEntryAtMs, now)}</td>
                  <td className="py-2">
                    <Pill status={r.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[var(--muted-foreground)]">
                    Nobody is listed yet: mark who is attending in Assignments.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Team coverage</h3>
        {coverage.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">The event&apos;s team list isn&apos;t available yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" data-testid="team-grid">
            {coverage.map((c) => (
              <li key={c.teamNumber} data-testid={`team-cell-${c.teamNumber}`} data-done={c.done ? "true" : "false"} className={cn("relative flex h-16 flex-col items-center justify-center overflow-hidden rounded-xl border text-sm", c.done ? "border-emerald-400/40 bg-emerald-500/10" : "border-[var(--glass-border)]", isOurs(c.teamNumber) && "ring-1 ring-[var(--color-primary)]")} title={c.name ?? undefined}>
                {pit && c.photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a Vercel Blob URL on a host we don't configure for next/image
                  <img src={c.photoUrl} alt={`Team ${c.teamNumber}`} className="absolute inset-0 h-full w-full object-cover opacity-40" data-testid={`team-photo-${c.teamNumber}`} />
                )}
                <span className="relative font-semibold tabular-nums">{c.teamNumber}</span>
                {c.done && <Check className="relative h-3.5 w-3.5 text-emerald-300" aria-label="Done" />}
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </>
  );
}

// --- Helper -------------------------------------------------------------------------------------------------------

function HelperStatus({ rows, now }: { rows: HelperCountRow[]; now: number }) {
  return (
    <GlassPanel className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Pit assists per person</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Person</th>
              <th className="py-1 pr-3 font-medium">Assists</th>
              <th className="py-1 pr-3 font-medium">Successful</th>
              <th className="py-1 font-medium">Last entry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} className="border-t border-[var(--glass-border)]" data-testid={`status-row-${r.uid}`}>
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className="py-2 pr-3 tabular-nums">{r.assists}</td>
                <td className="py-2 pr-3 tabular-nums">{r.successful}</td>
                <td className="py-2 text-xs">{ago(r.lastEntryAtMs, now)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-[var(--muted-foreground)]">
                  No pit assists logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

// --- connected ------------------------------------------------------------------------------------------------------

/**
 * The panel on live data: the event contexts and setups from `useScoutStatus` (so the category filter, ranges and the event filter apply), the team's form
 * entries, the FIRST team list, attendance and page access (who is an eligible scout for this form). `assignedCounts` (P31) prefills the team targets.
 */
export function FormStatusPanel({ type, views, eventCodes, members, canEdit, practice, assignedCounts }: { type: ScoutStatusFormType; views: EventSetupView[]; eventCodes: string[]; members: { uid: string; name: string; primaryRole: string; secondaryRoles: string[]; isAdmin: boolean; isOwner?: boolean }[]; canEdit: boolean; practice: boolean; assignedCounts: ReadonlyMap<string, number> | null }) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const data = useAnalyticsData();
  const { config } = usePageAccess();
  const { attendance } = useTeamEventAttendance(teamId);
  const { entries: all } = useFormEntries(teamId);
  const isOurs = useIsOurTeam();
  const [includeOurs, setIncludeOurs] = useState(false);
  const [now] = useState(() => Date.now());

  const requests = useMemo(() => eventCodes.map((code) => ({ code, season: data.eventDirectory.get(code)?.season ?? data.season })), [eventCodes, data.eventDirectory, data.season]);
  const { teams } = useEventTeams(type.unit === "team" ? requests : []);

  const entries = useMemo(() => (type.formType ? statusEntries(all, type.formType, eventCodes) : []), [all, type.formType, eventCodes]);
  const plans = useMemo(() => statusEntries(all, "match-strategy", eventCodes), [all, eventCodes]);

  const scouts = useMemo<ScoutDescriptor[]>(() => {
    const attending = new Set<string>();
    for (const a of attendance) if (eventCodes.includes(a.eventCode)) for (const uid of a.uids) attending.add(uid);
    const extras = new Set<string>();
    for (const v of views) for (const uid of v.setup.extraScouts) extras.add(uid);
    return eligibleFormScouts({
      members,
      attendingUids: attending,
      extraUids: extras,
      canAccess: (uid) => {
        const m = members.find((x) => x.uid === uid);
        return !!m && (!type.pageId || canAccessPage({ uid, isAdmin: m.isAdmin, isOwner: m.isOwner, primaryRole: m.primaryRole as never, secondaryRoles: m.secondaryRoles as never }, type.pageId, config));
      },
      roleLabel: (r) => getRole(r as never).label,
    });
  }, [members, attendance, eventCodes, views, type.pageId, config]);
  const nameFor = (uid: string, fallback: string) => members.find((m) => m.uid === uid)?.name ?? fallback;

  const singleView = views.length === 1 ? views[0] : null;
  const save = (view: EventSetupView, next: TeamTargetSetup) => {
    if (!teamId || !user || (type.id !== "pit-scout" && type.id !== "team-strategy")) return;
    void saveScoutTargets({ teamId, uid: user.uid }, view.eventCode, { ...view.setup, teamTargets: { ...view.setup.teamTargets, [type.id]: next } }).catch((err) => console.error("couldn't save the team targets:", err));
  };

  const props = useMemo<Omit<FormStatusViewProps, "type" | "now" | "multiEvent">>(() => {
    if (type.unit === "match-alliance") {
      const contexts: EventContext[] = views.map((v) => v.ctx);
      const units = allianceUnits(contexts);
      const targets = sumTargets(views.map((v) => v.targets as Map<string, CategoryRecord<TargetCell>>));
      return {
        alliance: {
          rows: allianceScoutRows({ scouts, entries, units, targets, playedFraction: practice ? 1 : playedFractionOf(contexts), nameFor }),
          coverage: allianceCoverage(units, entries, type.id === "drive-reflection" ? plans : []),
        },
      };
    }
    if (type.unit === "team") {
      const numbers = checkableTeams(teams.map((t) => t.teamNumber), isOurs, includeOurs);
      const names = new Map(teams.map((t) => [t.teamNumber, t.nameShort ?? ""]));
      const key = type.id as "pit-scout" | "team-strategy";
      const setupFor = (code: string) => views.find((v) => v.eventCode === code)?.setup.teamTargets?.[key];
      return {
        team: {
          rows: teamScoutRows({ scouts, entries, setupFor, eventCodes, assignedCounts, nameFor }),
          coverage: teamCoverage(numbers, entries, names),
          includeOurs,
          onIncludeOurs: setIncludeOurs,
          isOurs,
          all: singleView ? (singleView.setup.teamTargets?.[key]?.all ?? null) : null,
          canEdit: canEdit && singleView !== null,
          onSetAll: (n) => singleView && save(singleView, { ...singleView.setup.teamTargets?.[key], all: n, individual: singleView.setup.teamTargets?.[key]?.individual ?? {} }),
          onSetIndividual: (uid, n) => {
            if (!singleView) return;
            const cur = singleView.setup.teamTargets?.[key];
            const individual = { ...(cur?.individual ?? {}) };
            if (n === null) delete individual[uid];
            else individual[uid] = n;
            save(singleView, { ...cur, individual });
          },
        },
      };
    }
    return { helper: helperCountRows({ scouts, entries, nameFor }) };
    // nameFor/save close over members, user and the setups already listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, views, scouts, entries, plans, teams, includeOurs, isOurs, eventCodes, assignedCounts, practice, canEdit, singleView, members]);

  return <FormStatusView type={type} now={now} multiEvent={views.length > 1} {...props} />;
}

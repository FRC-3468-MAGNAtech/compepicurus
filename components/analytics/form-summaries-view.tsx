"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { OurTeamTag } from "@/components/analytics/team-bits";
import { latestPerUnit, type FormAnalyticsPage } from "@/lib/analytics/form-analytics";
import { STRATEGY_ABILITIES, helperAnalytics, leadScoutSummary, pitSummary, planRows, reflectionRows, teamStrategySummary, wentToPlan, type PitRow } from "@/lib/analytics/form-summaries";
import { useAnalyticsHref } from "@/lib/analytics/filter-context";
import type { FormEntry } from "@/lib/form-entries-model";
import { useIsOurTeam } from "@/lib/field-teams-context";
import { summarizeSequence } from "@/lib/forms/sequence";
import type { Form, FormField, ImageValue } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P30: the summary view of each of the new forms' Analytics pages. The raw table lives next to it; this boils it down per team or per match. The latest entry per team
// (or match and alliance) shows by default, with "see all" for the earlier ones. Everything is read from the entries' stored values (lib/analytics/form-summaries.ts).

type Props = { page: FormAnalyticsPage; form: Form; entries: FormEntry[]; allEntries: FormEntry[]; teamNames: ReadonlyMap<number, string>; hideNames: boolean };

const fieldOf = (form: Form, key: string): FormField | undefined => form.sections.flatMap((s) => s.fields).find((f) => f.key === key);
const optionLabel = (form: Form, key: string, value: string): string => fieldOf(form, key)?.options?.find((o) => o.value === value)?.label ?? (value || "—");
const allianceText = (a: "red" | "blue" | null) => (a === "red" ? "Red" : a === "blue" ? "Blue" : "");

function TeamChip({ team, names }: { team: number; names: ReadonlyMap<number, string> }) {
  const ours = useIsOurTeam()(team);
  const href = useAnalyticsHref();
  return (
    <Link href={href(`/analytics/teams/${team}`)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2.5 py-1 text-xs font-semibold tabular-nums hover:bg-white/10" title={names.get(team)}>
      {team}
      {ours && <OurTeamTag />}
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">{children}</GlassPanel>;
}

/** "Showing the latest entry per team. See all" toggle line. */
function LatestToggle({ showAll, onChange, what }: { showAll: boolean; onChange: (v: boolean) => void; what: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
      <span>{showAll ? `Showing every entry for each ${what}.` : `Showing the latest entry for each ${what}.`}</span>
      <Button type="button" variant="glass" size="sm" onClick={() => onChange(!showAll)} data-testid="see-all-toggle">
        {showAll ? "Latest only" : "See all entries"}
      </Button>
    </div>
  );
}

export function FormSummaryView(props: Props) {
  switch (props.page.slug) {
    case "lead-scout":
      return <LeadScoutSummary {...props} />;
    case "pit-scout":
      return <PitSummary {...props} />;
    case "team-strategy":
      return <StrategySummary {...props} />;
    case "match-strategy":
      return <MatchStrategySummary {...props} />;
    case "drive-reflection":
      return <ReflectionSummary {...props} />;
    case "helper":
      return <HelperSummary {...props} />;
  }
}

// --- Lead Scout -----------------------------------------------------------------------------------------------

function Skill({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[var(--muted-foreground)]">—</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${(value / 5) * 100}%`, background: "var(--theme-gradient)" }} />
      </span>
      {value.toFixed(1)}
    </span>
  );
}

function LeadScoutSummary({ entries, teamNames, hideNames }: Props) {
  const s = useMemo(() => leadScoutSummary(entries), [entries]);
  if (s.teams.length === 0 && s.alliances.length === 0) return <Empty>No Lead Scout entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-4" data-testid="summary-lead-scout">
      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Average skill per team</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="py-1 pr-3 font-medium">Team</th>
                <th className="py-1 pr-3 font-medium">Avg skill (1-5)</th>
                <th className="py-1 pr-3 font-medium">Ratings</th>
                <th className="py-1 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.teams.map((t) => (
                <tr key={t.teamNumber} className="border-t border-[var(--glass-border)] align-top" data-testid={`lead-team-${t.teamNumber}`}>
                  <td className="py-2 pr-3">
                    <TeamChip team={t.teamNumber} names={teamNames} />
                  </td>
                  <td className="py-2 pr-3">
                    <Skill value={t.averageSkill} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{t.entries}</td>
                  <td className="py-2">
                    {t.notes.length === 0 ? (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {t.notes.slice(0, 3).map((n, i) => (
                          <li key={i} className="text-xs">
                            {n.matchKey && <span className="mr-1 font-mono text-[var(--muted-foreground)]">{n.matchKey}</span>}
                            {n.text}
                            {!hideNames && <span className="ml-1 text-[var(--muted-foreground)]">— {n.scoutName}</span>}
                          </li>
                        ))}
                        {t.notes.length > 3 && <li className="text-xs text-[var(--muted-foreground)]">+{t.notes.length - 3} more in the table</li>}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Alliances</h3>
        <ul className="flex flex-col gap-2">
          {s.alliances.map((a) => (
            <li key={a.key} className={cn("rounded-2xl border px-3 py-2 text-sm", a.alliance === "red" ? "border-red-400/30 bg-red-500/5" : a.alliance === "blue" ? "border-sky-400/30 bg-sky-500/5" : "border-[var(--glass-border)]")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">{a.matchKey}</span>
                <span className="text-xs">{allianceText(a.alliance)}</span>
                <span className="flex flex-wrap gap-1">{a.teams.map((t) => <TeamChip key={t} team={t} names={teamNames} />)}</span>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">Alliance skill</span>
                <Skill value={a.allianceSkill} />
              </div>
              {a.allianceNotes && <p className="mt-1 text-xs">{a.allianceNotes}</p>}
            </li>
          ))}
        </ul>
      </GlassPanel>
    </div>
  );
}

// --- Pit Scout ------------------------------------------------------------------------------------------------

export function Lightbox({ photos, start, onClose, title }: { photos: ImageValue[]; start: number; onClose: () => void; title: string }) {
  const [i, setI] = useState(start);
  const photo = photos[i];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,900px)]" data-testid="lightbox">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Photo {i + 1} of {photos.length}
        </DialogDescription>
        {photo && (
          <div className="mt-2 flex max-h-[70vh] items-center justify-center overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- a Vercel Blob URL on a host we don't configure for next/image */}
            <img src={photo.url} alt={`${title}: photo ${i + 1}`} className="max-h-[70vh] w-auto max-w-full object-contain" />
          </div>
        )}
        {photos.length > 1 && (
          <div className="mt-3 flex justify-between gap-2">
            <Button variant="glass" size="sm" onClick={() => setI((i + photos.length - 1) % photos.length)}>
              Previous
            </Button>
            <Button variant="glass" size="sm" onClick={() => setI((i + 1) % photos.length)}>
              Next
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The capabilities grid: rows and columns from the form field, a check where the team can do it. */
export function CapabilityGrid({ field, value }: { field: FormField | undefined; value: Record<string, boolean> }) {
  if (!field?.rows || !field.cols) return null;
  const disabled = new Set(field.disabledCells ?? []);
  return (
    <table className="text-xs" data-testid="capability-grid">
      <thead>
        <tr>
          <th />
          {field.cols.map((c) => (
            <th key={c.key} className="px-2 py-0.5 text-left font-medium text-[var(--muted-foreground)]">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {field.rows.map((r) => (
          <tr key={r.key}>
            <th className="py-0.5 pr-2 text-left font-medium">{r.label}</th>
            {field.cols!.map((c) => {
              const cell = `${r.key}_${c.key}`;
              return (
                <td key={c.key} className="px-2 py-0.5" data-cell={cell} data-on={value[cell] === true ? "true" : "false"}>
                  {disabled.has(cell) ? <span className="text-[var(--muted-foreground)]">n/a</span> : value[cell] ? <Check className="h-3.5 w-3.5 text-emerald-300" aria-label="Yes" /> : <X className="h-3.5 w-3.5 text-[var(--muted-foreground)]/50" aria-label="No" />}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The auto cycle as a flow of chips (Leave > Hive > Garden > Hive > Park). */
export function AutoFlow({ field, ids }: { field: FormField | undefined; ids: string[] }) {
  if (ids.length === 0) return <span className="text-xs text-[var(--muted-foreground)]">No auto cycle recorded.</span>;
  const steps = field?.steps ?? [];
  const label = (id: string) => steps.find((s) => s.id === id)?.shortLabel ?? steps.find((s) => s.id === id)?.label ?? id;
  return (
    <div data-testid="auto-flow">
      <ol className="flex flex-wrap items-center gap-1" aria-label="Auto cycle">
        {ids.map((id, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-xs font-medium">{label(id)}</span>
            {i < ids.length - 1 && <ChevronRight className="h-3 w-3 text-[var(--muted-foreground)]" aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{summarizeSequence(steps, ids, " > ")}</p>
    </div>
  );
}

function PitCard({ row, form, names, older }: { row: PitRow; form: Form; names: ReadonlyMap<number, string>; older?: boolean }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const cap = fieldOf(form, "capabilities");
  const seq = fieldOf(form, "autoCycle");
  return (
    <GlassPanel className={cn("flex flex-col gap-3", older && "opacity-80")} data-testid={`pit-card-${row.teamNumber}`}>
      <div className="flex flex-wrap items-center gap-2">
        <TeamChip team={row.teamNumber} names={names} />
        <span className="text-sm text-[var(--muted-foreground)]">{names.get(row.teamNumber) ?? ""}</span>
        {row.rookie === true && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">Rookie</span>}
        <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{row.eventCode}{row.entryCount > 1 ? ` · ${row.entryCount} entries` : ""}</span>
      </div>
      {row.photos.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto" data-testid="pit-gallery">
          {row.photos.map((p, i) => (
            <button key={p.url} type="button" onClick={() => setLightbox(i)} className="h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-[var(--glass-border)]" aria-label={`Open photo ${i + 1} of team ${row.teamNumber}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a Vercel Blob URL on a host we don't configure for next/image */}
              <img src={p.url} alt={`Team ${row.teamNumber} robot, photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted-foreground)]">No photos.</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Fact label="Weight" value={row.weightLb === null ? null : `${row.weightLb} lb`} />
        <Fact label="Capacity" value={row.capacity} />
        <Fact label="Preloaded" value={row.preloaded} />
        <Fact label="Cycle time" value={row.cycleTime === null ? null : `${row.cycleTime} s`} />
      </div>
      <div className="flex flex-wrap gap-6">
        <CapabilityGrid field={cap} value={row.capabilities} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Auto cycle</div>
          <AutoFlow field={seq} ids={row.autoCycle} />
        </div>
      </div>
      {(row.friendlyPit || row.friendlyDrive) && (
        <p className="text-xs text-[var(--muted-foreground)]">{[row.friendlyPit ? "Friendly in the pit" : null, row.friendlyDrive ? "Friendly in drive" : null].filter(Boolean).join(" · ")}</p>
      )}
      {lightbox !== null && <Lightbox photos={row.photos} start={lightbox} onClose={() => setLightbox(null)} title={`Team ${row.teamNumber}`} />}
    </GlassPanel>
  );
}

export function Fact({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className="tabular-nums">{value === null || value === "" ? "—" : value}</div>
    </div>
  );
}

function PitSummary({ page, form, entries, teamNames }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => (showAll ? allPit(entries) : pitSummary(page, entries)), [showAll, entries, page]);
  if (entries.length === 0) return <Empty>No Pit Scout entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-3" data-testid="summary-pit-scout">
      <LatestToggle showAll={showAll} onChange={setShowAll} what="team" />
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <PitCard key={r.entryId} row={r} form={form} names={teamNames} older={showAll} />
        ))}
      </div>
    </div>
  );
}

/** Every entry as a card (newest first, then by team): "see all". */
function allPit(entries: FormEntry[]): PitRow[] {
  return entries
    .slice()
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .flatMap((e) => pitSummary({ unit: "team" }, [e]));
}

// --- Team Strategy --------------------------------------------------------------------------------------------

function StrategySummary({ page, form, entries, teamNames }: Props) {
  const s = useMemo(() => teamStrategySummary(page, entries), [page, entries]);
  const options = fieldOf(form, "bestAt")?.options ?? [];
  if (s.rows.length === 0) return <Empty>No Team Strategy entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-4" data-testid="summary-team-strategy">
      <GlassPanel className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Teams per best-at</h3>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <span key={o.value} className="rounded-full border border-[var(--glass-border)] px-3 py-1 text-sm" data-testid={`best-count-${o.value}`}>
              {o.label} <strong className="ml-1 tabular-nums">{s.bestAtCounts[o.value] ?? 0}</strong>
            </span>
          ))}
        </div>
      </GlassPanel>
      <GlassPanel className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Team</th>
              <th className="py-1 pr-3 font-medium">Best at</th>
              {STRATEGY_ABILITIES.map((a) => (
                <th key={a.key} className="py-1 pr-3 font-medium">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.entryId} className="border-t border-[var(--glass-border)]" data-testid={`strategy-row-${r.teamNumber}`}>
                <td className="py-2 pr-3">
                  <TeamChip team={r.teamNumber} names={teamNames} />
                </td>
                <td className="py-2 pr-3">{r.bestAt ? optionLabel(form, "bestAt", r.bestAt) : "—"}</td>
                {STRATEGY_ABILITIES.map((a) => (
                  <td key={a.key} className="py-2 pr-3">
                    {r.abilities[a.key] ? <Check className="h-4 w-4 text-emerald-300" aria-label="Yes" /> : <X className="h-4 w-4 text-[var(--muted-foreground)]/50" aria-label="No" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </GlassPanel>
    </div>
  );
}

// --- Match Strategy ---------------------------------------------------------------------------------------------

function PlanChips({ slots, form, names, auto = true }: { slots: { team: number; role: string; auto: boolean }[]; form: Form; names: ReadonlyMap<number, string>; auto?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {slots.map((s) => (
        <span key={s.team} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-xs" title={names.get(s.team)}>
          <strong className="tabular-nums">{s.team}</strong>
          <span>{optionLabel(form, "role", s.role)}</span>
          {auto && s.auto && <span className="rounded bg-amber-500/20 px-1 text-[10px] uppercase text-amber-200">Auto</span>}
        </span>
      ))}
    </span>
  );
}

function MatchStrategySummary({ page, form, entries, teamNames }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => (showAll ? entries.flatMap((e) => planRows(page, [e])).sort(byMatch) : planRows(page, entries)), [showAll, entries, page]);
  if (entries.length === 0) return <Empty>No Match Strategy entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-3" data-testid="summary-match-strategy">
      <LatestToggle showAll={showAll} onChange={setShowAll} what="match and alliance" />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.entryId} className={cn("flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-sm", r.alliance === "red" ? "border-red-400/30 bg-red-500/5" : "border-sky-400/30 bg-sky-500/5")} data-testid={`plan-${r.matchKey}-${r.alliance}`}>
            <span className="font-mono text-xs font-semibold">{r.matchKey}</span>
            <span className="text-xs">{allianceText(r.alliance)}</span>
            <PlanChips slots={r.slots} form={form} names={teamNames} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const byMatch = (a: { eventCode: string; matchKey: string | null; alliance: string | null; createdAtMs: number }, b: { eventCode: string; matchKey: string | null; alliance: string | null; createdAtMs: number }) =>
  a.eventCode.localeCompare(b.eventCode) || (a.matchKey ?? "").localeCompare(b.matchKey ?? "", undefined, { numeric: true }) || (a.alliance ?? "").localeCompare(b.alliance ?? "") || b.createdAtMs - a.createdAtMs;

// --- Drive Reflection -------------------------------------------------------------------------------------------

function ReflectionSummary({ page, form, entries, allEntries, teamNames }: Props) {
  const [showAll, setShowAll] = useState(false);
  const plans = useMemo(() => allEntries.filter((e) => e.formType === "match-strategy"), [allEntries]);
  const rows = useMemo(() => {
    const source = showAll ? entries : latestPerUnit(page, entries);
    return source.flatMap((e) => reflectionRows([e], plans, page)).sort(byMatch);
  }, [showAll, entries, plans, page]);
  const went = useMemo(() => wentToPlan(reflectionRows(latestPerUnit(page, entries), plans, page)), [entries, plans, page]);
  if (entries.length === 0) return <Empty>No Drive Reflection entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-3" data-testid="summary-drive-reflection">
      <GlassPanel className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Matches that went to plan</div>
          <div className="text-2xl font-semibold tabular-nums" data-testid="went-to-plan">{went.percent === null ? "—" : `${went.percent}%`}</div>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">{went.planned === 0 ? "None of these matches had a Match Strategy to compare with." : `${went.onPlan} of ${went.planned} reflections that had a plan matched it exactly.`}</p>
      </GlassPanel>
      <LatestToggle showAll={showAll} onChange={setShowAll} what="match and alliance" />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.entryId} className="flex flex-col gap-1.5 rounded-2xl border border-[var(--glass-border)] px-3 py-2 text-sm" data-testid={`reflection-${r.matchKey}-${r.alliance}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">{r.matchKey}</span>
              <span className="text-xs">{allianceText(r.alliance)}</span>
              {r.plan === null ? (
                <span className="text-xs text-[var(--muted-foreground)]">No plan to compare with</span>
              ) : r.differences.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200" data-testid="plan-caution">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {r.differences.length} difference{r.differences.length === 1 ? "" : "s"} from the plan
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                  <Check className="h-3 w-3" aria-hidden /> As planned
                </span>
              )}
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {r.plan && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Plan</div>
                  <PlanChips slots={r.plan.slots} form={form} names={teamNames} />
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Actual</div>
                <PlanChips slots={r.slots} form={form} names={teamNames} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Helper -----------------------------------------------------------------------------------------------------

function HelperSummary({ entries, teamNames, hideNames }: Props) {
  const a = useMemo(() => helperAnalytics(entries), [entries]);
  if (a.total === 0) return <Empty>No pit assists logged yet.</Empty>;
  return (
    <div className="flex flex-col gap-4" data-testid="summary-helper">
      <GlassPanel className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Assists logged</div>
          <div className="text-2xl font-semibold tabular-nums">{a.total}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Success rate</div>
          <div className="text-2xl font-semibold tabular-nums">{a.rate === null ? "—" : `${a.rate}%`}</div>
        </div>
      </GlassPanel>
      <GlassPanel className="overflow-x-auto">
        <h3 className="mb-2 text-sm font-semibold">Success rate per scout</h3>
        <table className="w-full min-w-[320px] text-sm">
          <thead className="text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Scout</th>
              <th className="py-1 pr-3 font-medium">Assists</th>
              <th className="py-1 pr-3 font-medium">Successful</th>
              <th className="py-1 font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {a.perScout.map((s, i) => (
              <tr key={s.scoutName} className="border-t border-[var(--glass-border)]" data-testid={`helper-scout-${i}`}>
                <td className="py-2 pr-3">{hideNames ? `Scout ${i + 1}` : s.scoutName}</td>
                <td className="py-2 pr-3 tabular-nums">{s.assists}</td>
                <td className="py-2 pr-3 tabular-nums">{s.successful}</td>
                <td className="py-2 tabular-nums">{s.rate === null ? "—" : `${s.rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassPanel>
      <GlassPanel className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Assist log</h3>
        <ul className="flex flex-col gap-1.5">
          {a.log.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--glass-border)] px-3 py-2 text-sm">
              {typeof e.teamNumber === "number" ? <TeamChip team={e.teamNumber} names={teamNames} /> : <span>—</span>}
              <span className="min-w-0 flex-1 text-xs">{typeof e.values.issues === "string" ? e.values.issues : ""}</span>
              <span className={e.values.successful === "yes" ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>{e.values.successful === "yes" ? "Solved" : "Not solved"}</span>
              <span className="text-[11px] text-[var(--muted-foreground)]">{e.eventCode}</span>
            </li>
          ))}
        </ul>
      </GlassPanel>
    </div>
  );
}

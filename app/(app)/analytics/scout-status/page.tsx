"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { CoverageList } from "@/components/scout-status/coverage-list";
import { FormStatusPanel } from "@/components/scout-status/form-status-panel";
import { IndividualTargets, MaxTargets, RangeEntry, type SetupChange } from "@/components/scout-status/setup-panels";
import { StatusTable } from "@/components/scout-status/status-table";
import { LoadError } from "@/components/practice/load-error";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import { CATEGORY_IDS, STATUS_CATEGORIES, type StatusCategory } from "@/lib/scout-status/categories";
import { DEFAULT_FORM_TYPE, scoutStatusFormType, scoutStatusFormTypes, type ScoutStatusFormTypeId } from "@/lib/scout-status/form-types";
import { saveScoutTargets } from "@/lib/scout-status/store";
import { assignedTeamCounts } from "@/lib/team-assignments/model";
import { useTeamAssignmentDocs } from "@/lib/team-assignments/store";
import { useScoutStatus } from "@/lib/scout-status/use-scout-status";
import { cn } from "@/lib/utils";

const ALL_EVENTS = "__all__";

/** A collapsible setup section (the setup data behind the table and coverage). Open for editors, collapsed for everyone else. */
function Section({ title, hint, defaultOpen, children }: { title: string; hint?: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-[var(--glass-border)]">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="font-semibold">{title}</span>
        {hint && <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline">{hint}</span>}
        <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

export default function ScoutStatusPage() {
  const { user, profile } = useAuth();
  const { can } = usePermissions();
  const canEdit = can("editScoutTargets");

  // P30: every form type is selectable; Match Scout is the original page, the alliance types (Lead Scout, Match Strategy, Drive Reflection) keep the ranges and
  // targets setup, the team types (Pit Scout, Team Strategy) and Helper have their own panel
  const [formTypeId, setFormTypeId] = useState<ScoutStatusFormTypeId>(DEFAULT_FORM_TYPE);
  const formType = scoutStatusFormType(formTypeId);
  const matchBased = formType.unit === "robot-match" || formType.unit === "match-alliance";

  const [enabledList, setEnabledList] = useState<StatusCategory[]>(CATEGORY_IDS);
  const enabled = useMemo(() => new Set(enabledList), [enabledList]);
  const status = useScoutStatus(enabled);
  // P31: what Assignments gave each scout prefills the teams-per-scout targets of Pit Scout and Team Strategy ("from assignments"); a manual number overrides it
  const teamAssignments = useTeamAssignmentDocs(profile?.teamId ?? null);
  const assignKind = formType.id === "pit-scout" ? "pit" : formType.id === "team-strategy" ? "teamStrategy" : null;
  const assignedCounts = useMemo(() => (assignKind ? assignedTeamCounts(teamAssignments.docs, status.eventCodes, assignKind) : null), [assignKind, teamAssignments.docs, status.eventCodes]);
  const [editing, setEditing] = useState<string>(ALL_EVENTS);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const multiEvent = status.views.length > 1;
  // One event: edit it directly. Several: the selector picks one (or the read-only summed view).
  const selected = status.views.length === 1 ? status.views[0] : (status.views.find((v) => v.eventCode === editing) ?? null);
  const summed = multiEvent && selected === null;
  const setupEditable = canEdit && selected !== null;
  const viewForRanges = selected ?? status.views[0] ?? null;

  const onChange: SetupChange = (eventCode, mutate) => {
    const view = status.views.find((v) => v.eventCode === eventCode);
    if (!view || !profile || !user) return;
    setSaveError(null);
    saveScoutTargets({ teamId: profile.teamId, uid: user.uid }, eventCode, mutate(view.setup)).catch((err) => {
      console.error("couldn't save the scout targets:", err);
      setSaveError("Couldn't save that change. You may be offline, or no longer allowed to edit.");
    });
  };

  const toggleCategory = (id: StatusCategory) => setEnabledList((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : CATEGORY_IDS.filter((c) => c === id || cur.includes(c))));

  return (
    <div className="flex flex-col gap-5">
      {/* 2. Form type */}
      <GlassPanel className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Scout status</h2>
          <p className="text-xs text-[var(--muted-foreground)]">How each scout is doing against their targets, and which robots in which matches have been scouted. Follows the filters above.</p>
        </div>

        <div role="tablist" aria-label="Form type" className="flex flex-wrap gap-1.5">
          {scoutStatusFormTypes.map((t) =>
            t.id === formTypeId ? (
              <button key={t.id} type="button" role="tab" aria-selected className="rounded-full px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)]" style={{ background: "var(--theme-gradient)" }} data-testid={`form-type-${t.id}`}>
                {t.label}
              </button>
            ) : (
              <button key={t.id} type="button" role="tab" aria-selected={false} onClick={() => setFormTypeId(t.id)} className="inline-flex rounded-full border border-[var(--glass-border)] px-4 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-white/8 hover:text-[var(--foreground)]" data-testid={`form-type-${t.id}`}>
                {t.label}
              </button>
            )
          )}
        </div>

        {/* 3. Match category filter */}
        {matchBased && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Match categories">
          {STATUS_CATEGORIES.map((c) => {
            const on = enabled.has(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} disabled={on && enabledList.length === 1} onClick={() => toggleCategory(c.id)} className={cn("rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed", on ? "border-transparent bg-white/15 text-[var(--foreground)]" : "border-[var(--glass-border)] text-[var(--muted-foreground)] hover:bg-white/6")}>
                {c.label}
              </button>
            );
          })}
          <span className="text-xs text-[var(--muted-foreground)]">Practice = event practice matches (not practice scouting).</span>
        </div>
        )}
      </GlassPanel>

      {status.setupsError && <LoadError failure={status.setupsError} onRetry={status.retrySetups} />}

      {!status.loaded ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading scout status">
          <div className="glass-card h-40 animate-pulse" />
          <div className="glass-card flex h-64 flex-col gap-3 p-5">
            <Shimmer className="h-4 w-1/3" />
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-4 w-1/2" />
          </div>
        </div>
      ) : status.eventCodes.length === 0 ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">No events in the current filters. Pick an event in the filter bar, or set the team&apos;s active events.</GlassPanel>
      ) : (
        <>
          {/* Setup: 3 range entry, 4 max targets, 5 individual targets */}
          {matchBased && (
          <GlassPanel className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold">Setup</h3>
              {!canEdit && (
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Read-only — only admins and Lead Scouts can change targets.
                </span>
              )}
              {multiEvent && (
                <label className="ml-auto flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  Editing targets for
                  <select value={selected ? selected.eventCode : ALL_EVENTS} onChange={(e) => setEditing(e.target.value)} className="h-9 rounded-xl border border-[var(--glass-border)] bg-white/5 px-2.5 text-sm text-[var(--foreground)] [&>option]:bg-[#1b1b26] [&>option]:text-white">
                    <option value={ALL_EVENTS}>All selected events (totals, read-only)</option>
                    {status.views.map((v) => (
                      <option key={v.eventCode} value={v.eventCode}>
                        {v.eventName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {summed && <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-[var(--muted-foreground)]">The table and coverage below add up all {status.views.length} events. Choose one event above to change its ranges and targets.</p>}
            {saveError && (
              <p role="alert" className="text-sm text-red-300">
                {saveError}
              </p>
            )}

            <Section title="Range entry" hint="Which matches count, per category" defaultOpen={canEdit}>
              {summed || !viewForRanges ? <SummedRanges views={status.views} enabled={enabled} /> : <RangeEntry view={viewForRanges} enabled={enabled} canEdit={setupEditable} onChange={onChange} />}
            </Section>
            <Section title="Max match targets" hint="The most matches any scout could scout" defaultOpen={canEdit}>
              {summed || !viewForRanges ? <SummedMax views={status.views} enabled={enabled} /> : <MaxTargets view={viewForRanges} enabled={enabled} canEdit={setupEditable} onChange={onChange} />}
            </Section>
            <Section title="Individual scout targets" hint="Matches each scout should scout, by category" defaultOpen={canEdit}>
              <IndividualTargets views={status.views} selected={selected} scouts={status.scouts} members={status.members} enabled={enabled} canEdit={setupEditable} onChange={onChange} />
            </Section>
          </GlassPanel>
          )}

          {formType.unit !== "robot-match" ? (
            <FormStatusPanel
              key={formType.id}
              type={formType}
              views={status.views}
              eventCodes={status.eventCodes}
              members={status.members}
              canEdit={canEdit}
              practice={status.practice}
              assignedCounts={assignedCounts}
            />
          ) : (
          <>
          {/* 6. Scout status table */}
          <GlassPanel className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Scout status table</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {status.entriesUsed} of {status.entriesInScope} entries count under the current filters. Entries are forms (a scout can scout more than one robot in a match); matches scouted counts each match once.
            </p>
            <StatusTable rows={status.rows} totals={status.totals} entries={status.entriesFiltered} events={status.views.map((v) => v.ctx)} enabled={enabled} hasAssignments={status.hasAssignments} now={now} />
          </GlassPanel>

          {/* 7. Match coverage */}
          <GlassPanel className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Match coverage</h3>
            <CoverageList coverage={status.coverage} enabled={enabled} showEvent={multiEvent} />
          </GlassPanel>
          </>
          )}
        </>
      )}
    </div>
  );
}

function SummedRanges({ views, enabled }: { views: { eventCode: string; eventName: string; ctx: { matches: { category: StatusCategory }[] } }[]; enabled: ReadonlySet<StatusCategory> }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {views.map((v) => (
        <li key={v.eventCode} className="flex flex-wrap gap-x-3">
          <span className="font-medium">{v.eventName}</span>
          <span className="text-[var(--muted-foreground)]">{STATUS_CATEGORIES.filter((c) => enabled.has(c.id)).map((c) => `${c.prefix} ${v.ctx.matches.filter((m) => m.category === c.id).length}`).join(" · ")} matches counted</span>
        </li>
      ))}
    </ul>
  );
}

function SummedMax({ views, enabled }: { views: { maxes: Record<StatusCategory, { value: number | null }> }[]; enabled: ReadonlySet<StatusCategory> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {STATUS_CATEGORIES.filter((c) => enabled.has(c.id)).map((c) => (
        <div key={c.id} className="rounded-2xl border border-[var(--glass-border)] bg-white/4 p-3">
          <div className="text-xs text-[var(--muted-foreground)]">{c.label}</div>
          <div className="text-lg font-semibold tabular-nums">{views.reduce((sum, v) => sum + (v.maxes[c.id].value ?? 0), 0)}</div>
        </div>
      ))}
    </div>
  );
}

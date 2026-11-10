"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check, ClipboardList, HandHelping, Lightbulb, Wrench } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber, teamHref } from "@/components/dashboard/shared";
import { useDashboard } from "@/lib/dashboard/data";
import { formCoverage, helperSummary } from "@/lib/dashboard/form-coverage";
import type { FormEntryType } from "@/lib/form-entries-model";
import { assignmentProgress } from "@/lib/team-assignments/distribute";
import { TEAM_ASSIGN_KIND_INFO, myAssignedTeams, type TeamAssignKind } from "@/lib/team-assignments/model";
import { KIND_FORM_TYPE } from "@/lib/team-assignments/store";

// P29: the dashboard widgets for the Pit Scout, Team Strategy and Helper forms. They read the event's `formEntries` from the dashboard's one provider.

const SHOWN = 12;

/** The event's team numbers (the FIRST team list). */
function useEventTeams(): number[] {
  const d = useDashboard();
  return useMemo(() => [...new Set(d.teams.map((t) => t.teamNumber))].sort((a, b) => a - b), [d.teams]);
}

const loadingOf = (d: ReturnType<typeof useDashboard>) => !d.formEntriesLoaded || d.first.loading;

/** "12 of 30 teams have a pit entry" — a number and the link to the form. */
export function FormCoverageWidget({ formType, title, noun, href, linkLabel }: { formType: FormEntryType; title: string; noun: string; href: string; linkLabel: string }) {
  const d = useDashboard();
  const teams = useEventTeams();
  const c = useMemo(() => formCoverage(teams, d.formEntries, formType), [teams, d.formEntries, formType]);
  return (
    <Widget title={title} icon={formType === "pit-scout" ? Wrench : Lightbulb} size="small" status={loadingOf(d) ? "loading" : c.total === 0 ? "empty" : "ready"} href={href} linkLabel={linkLabel} emptyText="No teams to cover yet — the event's team list isn't available.">
      <KeyNumber label="Coverage" value={`${c.percent ?? 0}%`} hint={`${c.done} of ${c.total} teams have a ${noun}`} />
    </Widget>
  );
}

/** The teams with no entry of this form yet, as chips that open the Team Profile. */
export function FormMissingTeamsWidget({ formType, title, noun, href, linkLabel }: { formType: FormEntryType; title: string; noun: string; href: string; linkLabel: string }) {
  const d = useDashboard();
  const teams = useEventTeams();
  const c = useMemo(() => formCoverage(teams, d.formEntries, formType), [teams, d.formEntries, formType]);
  const code = d.event?.code ?? null;
  const more = c.missing.length - SHOWN;
  return (
    <Widget title={title} icon={ClipboardList} size="medium" status={loadingOf(d) ? "loading" : c.total === 0 ? "empty" : "ready"} href={href} linkLabel={linkLabel} emptyText="No teams to list yet.">
      {c.missing.length === 0 ? (
        <p className="text-sm text-emerald-300">Every team at this event has a {noun}.</p>
      ) : (
        <>
          <div className="text-xs text-[var(--muted-foreground)]">
            {c.missing.length} {c.missing.length === 1 ? "team has" : "teams have"} no {noun} yet
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid={`missing-${formType}`}>
            {c.missing.slice(0, SHOWN).map((t) => (
              <Link key={t} href={teamHref(t, code)} className="glass-pill px-3 py-1.5 text-sm font-semibold tabular-nums transition-shadow hover:shadow-[0_0_20px_2px_rgba(var(--glow),0.3)]" title={d.teamNames.get(t)}>
                {t}
              </Link>
            ))}
            {more > 0 && <span className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">+{more} more</span>}
          </div>
        </>
      )}
    </Widget>
  );
}

/** The Helper form's log: how many times the team helped another in the pit, and how often it worked. */
export function HelperLogWidget() {
  const d = useDashboard();
  const s = useMemo(() => helperSummary(d.formEntries), [d.formEntries]);
  const code = d.event?.code ?? null;
  return (
    <Widget title="Pit assists" icon={HandHelping} size="medium" status={!d.formEntriesLoaded ? "loading" : s.total === 0 ? "empty" : "ready"} href="/helper-form" linkLabel="Helper Form" emptyText="No pit assists logged at this event yet.">
      <KeyNumber label="Assists logged" value={String(s.total)} hint={s.rate === null ? undefined : `${s.successful} successful (${s.rate}%)`} />
      <div className="flex flex-col gap-1">
        {s.recent.map((e) => (
          <div key={e.id} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-sm">
            {typeof e.teamNumber === "number" ? (
              <Link href={teamHref(e.teamNumber, code)} className="font-semibold tabular-nums">
                {e.teamNumber}
              </Link>
            ) : (
              <span>—</span>
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">{typeof e.values.issues === "string" ? e.values.issues : ""}</span>
            <span className={e.values.successful === "yes" ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>{e.values.successful === "yes" ? "Solved" : "Not solved"}</span>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/** P31: the teams the person was assigned for this form at the selected event, checked off as they do them: "7 of 12 done". */
export function MyAssignedTeamsWidget({ kind }: { kind: TeamAssignKind }) {
  const d = useDashboard();
  const info = TEAM_ASSIGN_KIND_INFO[kind];
  const code = d.event?.code ?? null;
  const mine = useMemo(() => myAssignedTeams(d.teamAssignments, code, kind, d.uid), [d.teamAssignments, code, kind, d.uid]);
  const done = useMemo(() => new Set(d.formEntries.filter((e) => e.uid === d.uid && e.formType === KIND_FORM_TYPE[kind] && !e.excluded && typeof e.teamNumber === "number").map((e) => e.teamNumber as number)), [d.formEntries, d.uid, kind]);
  const p = assignmentProgress(mine, done);
  return (
    <Widget title="My assigned teams" icon={kind === "pit" ? Wrench : Lightbulb} size="medium" status={!d.teamAssignmentsLoaded || !d.formEntriesLoaded ? "loading" : mine.length === 0 ? "empty" : "ready"} href={info.href} linkLabel={`${info.tab} Form`} emptyText={`No ${info.noun} teams have been assigned to you at this event.`}>
      <KeyNumber label="Progress" value={`${p.done} of ${p.total}`} hint={p.remaining.length === 0 ? "All done" : `${p.remaining.length} to go`} />
      <div className="flex flex-wrap gap-1.5" data-testid={`assigned-${kind}`}>
        {mine.map((t) => (
          <Link key={t} href={`${info.href}`} className={`glass-pill flex items-center gap-1 px-3 py-1.5 text-sm font-semibold tabular-nums ${done.has(t) ? "opacity-60" : ""}`} title={d.teamNames.get(t)}>
            {t}
            {done.has(t) && <Check className="h-3.5 w-3.5 text-emerald-300" aria-label="Done" />}
          </Link>
        ))}
      </div>
    </Widget>
  );
}

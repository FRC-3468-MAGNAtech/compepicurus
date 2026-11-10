"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AutoFlow, CapabilityGrid, Fact, Lightbox } from "@/components/analytics/form-summaries-view";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAnalyticsData } from "@/lib/analytics/data-context";
import { useAnalyticsFilters, useAnalyticsHref } from "@/lib/analytics/filter-context";
import { eventCodesForScope } from "@/lib/analytics/form-analytics";
import { teamPitStrategy, type TeamPitStrategy } from "@/lib/analytics/form-summaries";
import { useAuth } from "@/lib/auth";
import { useFormEntries } from "@/lib/form-entries";
import { getBuiltinForm } from "@/lib/forms/builtin";
import { useForms } from "@/lib/forms/forms-context";
import type { Form } from "@/lib/forms/types";

const TYPES = new Set(["pit-scout", "team-strategy", "lead-scout"]);

/** The Team Profile's "Pit and Strategy" section: what the pit, strategy and lead-scout forms say about the team. Left out entirely when none has anything. */
export function PitAndStrategySection({ teamNumber }: { teamNumber: number }) {
  const { profile } = useAuth();
  const { filters } = useAnalyticsFilters();
  const data = useAnalyticsData();
  const forms = useForms();
  const { entries, loaded } = useFormEntries(profile?.teamId ?? null);
  const codes = useMemo(() => eventCodesForScope(filters.events, data.activeEventCodes), [filters.events, data.activeEventCodes]);
  const inScope = useMemo(() => entries.filter((e) => TYPES.has(e.formType) && !e.excluded && (codes === null || codes.includes(e.eventCode))), [entries, codes]);
  const info = useMemo(() => teamPitStrategy(teamNumber, inScope), [teamNumber, inScope]);
  const pitForm = forms.latest("pit-scout-v1") ?? getBuiltinForm("pit-scout-v1")!;
  const strategyForm = forms.latest("team-strategy-v1") ?? getBuiltinForm("team-strategy-v1")!;
  if (!loaded || !info.any) return null;
  return <PitAndStrategyView teamNumber={teamNumber} info={info} pitForm={pitForm} strategyForm={strategyForm} />;
}

const optionLabel = (form: Form, key: string, value: string) => form.sections.flatMap((s) => s.fields).find((f) => f.key === key)?.options?.find((o) => o.value === value)?.label ?? value;

export function PitAndStrategyView({ teamNumber, info, pitForm, strategyForm }: { teamNumber: number; info: TeamPitStrategy; pitForm: Form; strategyForm: Form }) {
  const withFilters = useAnalyticsHref();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const { pit, strategy } = info;
  const field = (form: Form, key: string) => form.sections.flatMap((s) => s.fields).find((f) => f.key === key);
  const abilities = strategy ? Object.entries(strategy.abilities).filter(([, on]) => on).map(([k]) => field(strategyForm, k)?.label ?? k) : [];
  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="pit-and-strategy">
      <h2 className="text-base font-semibold">Pit and strategy</h2>

      {pit && pit.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" data-testid="profile-photos">
          {pit.photos.map((p, i) => (
            <button key={p.url} type="button" onClick={() => setLightbox(i)} className="h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-[var(--glass-border)]" aria-label={`Open photo ${i + 1} of team ${teamNumber}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a Vercel Blob URL on a host we don't configure for next/image */}
              <img src={p.url} alt={`Team ${teamNumber} robot, photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {pit && <Fact label="Cycle time" value={pit.cycleTime === null ? null : `${pit.cycleTime} s`} />}
        {pit && <Fact label="Capacity" value={pit.capacity} />}
        {pit && <Fact label="Preloaded" value={pit.preloaded} />}
        {strategy && <Fact label="Best at" value={strategy.bestAt ? optionLabel(strategyForm, "bestAt", strategy.bestAt) : null} />}
        {info.leadSkill !== null && <Fact label={`Lead scout skill (${info.leadRatings} rating${info.leadRatings === 1 ? "" : "s"})`} value={`${info.leadSkill.toFixed(1)} / 5`} />}
      </div>

      {abilities.length > 0 && (
        <p className="text-sm" data-testid="profile-abilities">
          <span className="text-[var(--muted-foreground)]">Can: </span>
          {abilities.join(" · ")}
        </p>
      )}

      {pit && (
        <div className="flex flex-wrap gap-6">
          <CapabilityGrid field={field(pitForm, "capabilities")} value={pit.capabilities} />
          {pit.autoCycle.length > 0 && (
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Auto cycle</div>
              <AutoFlow field={field(pitForm, "autoCycle")} ids={pit.autoCycle} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        {pit && (
          <Link href={withFilters("/analytics/pit-scout", { view: "summary" })} className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline">
            Pit Scout Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
        {strategy && (
          <Link href={withFilters("/analytics/team-strategy", { view: "summary" })} className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline">
            Team Strategy Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
        {info.leadSkill !== null && (
          <Link href={withFilters("/analytics/lead-scout", { view: "summary" })} className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline">
            Lead Scout Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {lightbox !== null && pit && <Lightbox photos={pit.photos} start={lightbox} onClose={() => setLightbox(null)} title={`Team ${teamNumber}`} />}
    </GlassPanel>
  );
}

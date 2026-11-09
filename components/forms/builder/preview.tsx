"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Maximize2, Monitor, RotateCcw, Smartphone, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScoutForm, type ScoutFormHandle } from "@/components/scout/scout-form";
import { GenericPreview, type GenericPreviewHandle } from "@/components/forms/builder/generic-preview";
import { phaseLabel, type Form, type FormValues } from "@/lib/forms/types";
import type { ScoreResult } from "@/lib/forms/scoring";
import { cn } from "@/lib/utils";

// P22: the live preview: the real <ScoutForm /> for the form as it is right now, in a phone / tablet / desktop frame. It is a "test fill": you can
// tap through it and watch the score, and nothing is ever written (there is no submit; "Check required fields" only validates). Edits to the form
// keep what you've filled in where the field still exists.

type Device = "mobile" | "tablet" | "desktop";
const WIDTH: Record<Device, string> = { mobile: "w-[390px]", tablet: "w-[768px]", desktop: "w-[1100px]" };
const DEVICES: { id: Device; label: string; icon: typeof Smartphone }[] = [
  { id: "mobile", label: "Phone", icon: Smartphone },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "desktop", label: "Desktop", icon: Monitor },
];

/** What changes the shape of the rendered form (so the preview remounts and re-applies defaults), as a cheap signature. */
function signature(form: Form): string {
  return JSON.stringify([form.scoringEnabled, form.phaseLabels, form.sections.map((s) => [s.id, s.visible, s.phase, s.accent, s.groups, s.fields.map((f) => [f.id, f.key, f.type, f.required, f.default, f.options, f.visibleWhen, f.min, f.max, f.step, f.scale, f.decimals, f.ui, f.tip, f.helpText, f.label, f.scoring, f.steps, f.rows, f.cols, f.disabledCells, f.maxCount, f.capture, f.endLabels, f.ticks])]), form.formType, form.compareWith, form.stickyNotes]);
}

export function LivePreview({ form, framed = true }: { form: Form; framed?: boolean }) {
  const [device, setDevice] = useState<Device>("mobile");
  const [full, setFull] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filled, setFilled] = useState<FormValues>({});
  const handle = useRef<ScoutFormHandle>(null);
  const genericHandle = useRef<GenericPreviewHandle>(null);
  const deferred = useDeferredValue(form);
  const sig = useMemo(() => signature(deferred), [deferred]);

  const frame = (fullHeight: boolean) => (
    <div className={cn("overflow-auto rounded-3xl border border-[var(--glass-border)] bg-[var(--background)] p-3", fullHeight ? "max-h-[72vh]" : "max-h-[60vh]")} data-testid={`preview-frame-${device}`}>
      <div className={cn("mx-auto max-w-full", WIDTH[device])}>
        {deferred.formType !== "match-scout" ? (
          <GenericPreview key={`${sig}:${resetCount}`} ref={genericHandle} form={deferred} initialValues={filled} onValues={setFilled} />
        ) : (
        <ScoutForm
          key={`${sig}:${resetCount}`}
          ref={handle}
          schema={deferred}
          mode="practice"
          layout="page"
          hideMatchPicker
          showSubmitButton={false}
          lockedFields={["teamNumber"]}
          prefill={{ teamNumber: 9999, scoutName: "Preview", values: filled }}
          onChange={(v, s) => {
            setFilled(v.values);
            setScore(s);
          }}
        />
        )}
      </div>
    </div>
  );

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="glass-pill inline-flex items-center gap-0.5 p-0.5" role="group" aria-label="Preview size">
        {DEVICES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={device === id} aria-label={label} title={label} onClick={() => setDevice(id)} className={cn("flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted-foreground)]", device === id && "text-[var(--color-primary-foreground)]")} style={device === id ? { background: "var(--theme-gradient)" } : undefined}>
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      <Button
        variant="glass"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          setFilled({});
          setResetCount((n) => n + 1);
          setNotice(null);
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" /> Clear
      </Button>
      <Button
        variant="glass"
        size="sm"
        onClick={() => {
          const ok = (deferred.formType !== "match-scout" ? genericHandle.current?.validate() : handle.current?.validate()) ?? true;
          setNotice(ok ? "Everything required is filled in." : "Some required fields are empty (shown in red).");
        }}
      >
        Check required fields
      </Button>
      {framed && (
        <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={() => setFull(true)}>
          <Maximize2 className="h-3.5 w-3.5" /> Open as scout
        </Button>
      )}
    </div>
  );

  const scoreLine = deferred.scoringEnabled && score && (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl border border-[var(--glass-border)] bg-white/[0.04] px-3 py-2" data-testid="preview-score">
      <span className="text-xs text-[var(--muted-foreground)]">Test score</span>
      <span className="text-xl font-bold tabular-nums">{score.total}</span>
      {Object.entries(score.byPhase)
        .filter(([phase]) => phase !== "prematch")
        .map(([phase, pts]) => (
          <span key={phase} className="text-xs text-[var(--muted-foreground)]">
            {phaseLabel(deferred, phase)} {pts}
          </span>
        ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="live-preview">
      <p className="text-xs text-[var(--muted-foreground)]">A test fill of the real form{deferred.formType !== "match-scout" ? ", with sample events and teams" : ""}. Nothing you enter here is saved.</p>
      {controls}
      {scoreLine}
      {notice && (
        <p role="status" className="text-xs text-[var(--muted-foreground)]">
          {notice}
        </p>
      )}
      {frame(false)}
      {framed && (
        <Dialog open={full} onOpenChange={setFull}>
          <DialogContent className="w-[min(96vw,1180px)] max-h-[92vh] overflow-hidden">
            <DialogTitle>Open as scout</DialogTitle>
            <DialogDescription>Test fill only: nothing is saved. Close this to keep editing.</DialogDescription>
            <div className="mt-3 flex flex-col gap-3">{full && <LivePreview form={form} framed={false} />}</div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

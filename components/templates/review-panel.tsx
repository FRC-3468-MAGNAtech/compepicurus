"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Check, Eye, Flag, Loader2, ShieldOff, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { DiffView } from "@/components/forms/builder/diff-view";
import { TemplateCard } from "@/components/templates/template-card";
import { ReasonDialog, TemplatePreviewDialog } from "@/components/templates/template-dialogs";
import { TemplatesProvider } from "@/lib/templates/firestore-service";
import { useTemplates, type TemplateReport } from "@/lib/templates/service";
import { diffForms } from "@/lib/forms/diff";
import type { FormTemplate, TemplateContent } from "@/lib/templates/build";

// P23: Admin Panel > Template Review (platform owners only). The moderation queue: templates waiting for a first review, updates to public templates
// waiting for review (the approved version stays live until then), reported templates, and every public template (take down, mark official), plus
// "Seed official templates" (publishes the BIOBUZZ and Blank templates, or adds a version when they changed). Every decision is made by the server (the
// rules refuse them from a browser) and logged in the platform log and the author's audit log; the author is emailed.

type Act = { kind: "preview" | "reject" | "takedown" | "review-update"; t: FormTemplate } | null;

export function ReviewPanelHost() {
  return (
    <TemplatesProvider>
      <ReviewPanel />
    </TemplatesProvider>
  );
}

export function ReviewPanel() {
  const svc = useTemplates();
  const [act, setAct] = useState<Act>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!svc.isPlatformOwner) {
    return (
      <GlassPanel role="alert" className="text-sm text-[var(--muted-foreground)]">
        Only platform owners review templates.
      </GlassPanel>
    );
  }

  const withUpdates = svc.publicTemplates.filter((t) => t.hasPendingUpdate);
  const reported = svc.publicTemplates.filter((t) => t.reportCount > 0);
  const close = () => setAct(null);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const btn = (label: string, icon: typeof Eye, onClick: () => void, o: { aria: string; variant?: "glass" | "primary" | "danger" | "ghost"; disabled?: boolean }) => {
    const Icon = icon;
    return (
      <Button key={label} size="sm" variant={o.variant ?? "glass"} className="gap-1.5" aria-label={o.aria} disabled={busy || o.disabled} onClick={onClick}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-5" data-testid="template-review">
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Template Review</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Nothing becomes public until you approve it. Decisions are logged, and the author is told.</p>
        </div>
        <Button
          variant="glass"
          className="gap-2"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await svc.seedOfficial();
              setNotice(`Official templates: ${r.map((x) => `${x.id.replace("official-", "")} ${x.result}`).join(", ")}.`);
            }, "")
          }
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Seed official templates
        </Button>
      </GlassPanel>

      {notice && (
        <p role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <Section title="Waiting for review" count={svc.queue.length} empty="Nothing is waiting for a first review.">
        {svc.queue.map((t) => (
          <TemplateCard
            key={t.id}
            t={t}
            actions={[
              btn("Preview", Eye, () => setAct({ kind: "preview", t }), { aria: `Preview ${t.name}` }),
              btn("Approve", Check, () => void run(() => svc.approve(t.id), `Approved “${t.name}”.`), { aria: `Approve ${t.name}`, variant: "primary" }),
              btn("Reject", X, () => setAct({ kind: "reject", t }), { aria: `Reject ${t.name}`, variant: "danger" }),
            ]}
          />
        ))}
      </Section>

      <Section title="Updates waiting for review" count={withUpdates.length} empty="No public template has an update waiting.">
        {withUpdates.map((t) => (
          <TemplateCard key={t.id} t={t} actions={[btn("Review update", Eye, () => setAct({ kind: "review-update", t }), { aria: `Review the update to ${t.name}`, variant: "primary" })]} />
        ))}
      </Section>

      <Section title="Reported" count={reported.length} empty="No public template has been reported.">
        {reported.map((t) => (
          <TemplateCard
            key={t.id}
            t={t}
            extra={<Reports id={t.id} count={t.reportCount} />}
            actions={[
              btn("Preview", Eye, () => setAct({ kind: "preview", t }), { aria: `Preview ${t.name}` }),
              btn("Dismiss reports", Flag, () => void run(() => svc.dismissReports(t.id), `Dismissed the reports on “${t.name}”.`), { aria: `Dismiss the reports on ${t.name}` }),
              btn("Take down", ShieldOff, () => setAct({ kind: "takedown", t }), { aria: `Take down ${t.name}`, variant: "danger" }),
            ]}
          />
        ))}
      </Section>

      <Section title="Public templates" count={svc.publicTemplates.length} empty="No public templates yet. Seed the official ones above.">
        {svc.publicTemplates.map((t) => (
          <TemplateCard
            key={t.id}
            t={t}
            actions={[
              btn("Preview", Eye, () => setAct({ kind: "preview", t }), { aria: `Preview ${t.name}` }),
              btn(t.official ? "Remove official" : "Mark official", BadgeCheck, () => void run(() => svc.setOfficial(t.id, !t.official), t.official ? `“${t.name}” is no longer official.` : `“${t.name}” is now official.`), { aria: `${t.official ? "Remove the official badge from" : "Mark official:"} ${t.name}` }),
              btn("Take down", ShieldOff, () => setAct({ kind: "takedown", t }), { aria: `Take down ${t.name}`, variant: "danger" }),
            ]}
          />
        ))}
      </Section>

      <TemplatePreviewDialog template={act?.kind === "preview" ? act.t : null} onClose={close} />
      <ReasonDialog
        open={act?.kind === "reject"}
        onClose={close}
        title="Reject this template"
        description="The author sees your reason and can fix the template and ask again."
        label="Reason"
        confirmLabel="Reject"
        danger
        onConfirm={(reason) => (act?.kind === "reject" ? run(() => svc.reject(act.t.id, reason), `Rejected “${act.t.name}”.`) : Promise.resolve())}
      />
      <ReasonDialog
        open={act?.kind === "takedown"}
        onClose={close}
        title="Take this template down"
        description="It's removed from the public library and goes back to its author with your reason. Accounts that already used it keep their copies."
        label="Reason"
        confirmLabel="Take down"
        danger
        onConfirm={(reason) => (act?.kind === "takedown" ? run(() => svc.takeDown(act.t.id, reason), `Took down “${act.t.name}”.`) : Promise.resolve())}
      />
      <ReviewUpdateDialog
        template={act?.kind === "review-update" ? act.t : null}
        onClose={close}
        onApprove={(t) => run(() => svc.approve(t.id), `Approved the update to “${t.name}”.`)}
        onReject={(t, reason) => run(() => svc.reject(t.id, reason), `Rejected the update to “${t.name}”.`)}
      />
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
        {count > 0 && <span className="rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[11px] text-[var(--color-primary-foreground)]">{count}</span>}
      </h3>
      {count === 0 ? <p className="text-sm text-[var(--muted-foreground)]">{empty}</p> : <ul className="grid gap-3 lg:grid-cols-2">{Array.isArray(children) ? children.map((c, i) => <li key={i}>{c}</li>) : <li>{children}</li>}</ul>}
    </section>
  );
}

function Reports({ id, count }: { id: string; count: number }) {
  const svc = useTemplates();
  const [reports, setReports] = useState<TemplateReport[] | null>(null);
  useEffect(() => {
    let alive = true;
    svc.getReports(id).then((r) => alive && setReports(r)).catch(() => alive && setReports([]));
    return () => {
      alive = false;
    };
  }, [svc, id, count]);
  return (
    <ul className="flex flex-col gap-1 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs" aria-label="Reports">
      <li className="font-semibold">{count} report{count === 1 ? "" : "s"}</li>
      {(reports ?? []).map((r, i) => (
        <li key={i}>“{r.reason}”</li>
      ))}
    </ul>
  );
}

function ReviewUpdateDialog({ template, onClose, onApprove, onReject }: { template: FormTemplate | null; onClose: () => void; onApprove: (t: FormTemplate) => Promise<void>; onReject: (t: FormTemplate, reason: string) => Promise<void> }) {
  const svc = useTemplates();
  const [loaded, setLoaded] = useState<{ id: string; update: (TemplateContent & { version: number }) | null } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => {
    if (!template) return;
    let alive = true;
    svc.getPendingUpdate(template.id).then((update) => alive && setLoaded({ id: template.id, update })).catch(() => alive && setLoaded({ id: template.id, update: null }));
    return () => {
      alive = false;
    };
  }, [svc, template]);
  const update = template && loaded?.id === template.id ? loaded.update : undefined;
  return (
    <>
      <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="w-[min(96vw,760px)] max-h-[90vh] overflow-y-auto">
          <DialogTitle>Update to “{template?.name}”</DialogTitle>
          <DialogDescription>Version {template?.version} is live. This is what version {update?.version ?? "…"} would change.</DialogDescription>
          <div className="mt-3">
            {update === undefined && <div className="glass-card h-24 animate-pulse" />}
            {update === null && <p className="text-sm text-[var(--muted-foreground)]">The update isn&apos;t there any more.</p>}
            {template && update && (
              <div className="flex flex-col gap-3">
                {(update.name !== template.name || update.description !== template.description || update.tags.join() !== template.tags.join()) && (
                  <ul className="list-disc rounded-xl border border-[var(--glass-border)] py-2 pl-7 pr-3 text-xs">
                    {update.name !== template.name && <li>Name: “{template.name}” → “{update.name}”</li>}
                    {update.description !== template.description && <li>Description changed</li>}
                    {update.tags.join() !== template.tags.join() && <li>Tags: {template.tags.join(", ") || "none"} → {update.tags.join(", ") || "none"}</li>}
                  </ul>
                )}
                <DiffView diff={diffForms(template.form, update.form)} emptyText="The form itself is unchanged." />
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="danger" disabled={!update} onClick={() => setRejecting(true)}>
              Reject update
            </Button>
            <Button
              disabled={!update}
              onClick={async () => {
                if (!template) return;
                await onApprove(template);
                onClose();
              }}
            >
              Approve update
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ReasonDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject this update"
        description="The version that's already public stays live. The author sees your reason."
        label="Reason"
        confirmLabel="Reject update"
        danger
        onConfirm={async (reason) => {
          if (!template) return;
          await onReject(template, reason);
          setRejecting(false);
          onClose();
        }}
      />
    </>
  );
}

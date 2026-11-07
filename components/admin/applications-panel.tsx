"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ExternalLink, Info, Loader2, ShieldBan, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Label, Textarea } from "@/components/ui/input";
import { APPLICATION_LIMITS, APPLICATION_STATUS_LABEL, describeSignals, type ApplicationStatus, type SignalTone } from "@/lib/applications";
import {
  decideApplication,
  fetchApplicationConfig,
  statusOf,
  useAllApplications,
  useApplicationBlocks,
  useApplicationPrivate,
  type ApplicationConfig,
  type TeamApplication,
} from "@/lib/applications-client";
import { getRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

type Filter = "all" | ApplicationStatus | "blocks";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "blocked", label: "Blocked" },
  { id: "expired", label: "Expired" },
  { id: "all", label: "All" },
  { id: "blocks", label: "Block list" },
];

const TONE_CLASS: Record<SignalTone, string> = {
  good: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  warn: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  bad: "border-red-400/30 bg-red-500/10 text-red-200",
  neutral: "border-[var(--glass-border)] bg-white/5 text-[var(--muted-foreground)]",
};

const fmt = (ms: number | null) => (ms === null ? "just now" : new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));

/**
 * P20: Admin Panel > Team Applications (platform owners only). The review queue: filter by status, open an application
 * to see what was submitted and the **verification signals** (email verified, whether FIRST has the team and the name
 * matches, account age, repeats from the same network, CAPTCHA, an existing account), keep private notes, and
 * Approve / Reject (with a reason the applicant sees) / Block (email and/or team number). Approval creates the
 * account in one server transaction and is never automatic. A warning banner appears when Turnstile or email isn't configured.
 */
export function ApplicationsPanel() {
  const { applications, loaded } = useAllApplications(true);
  const blocks = useApplicationBlocks(true);
  const [config, setConfig] = useState<ApplicationConfig | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    fetchApplicationConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  const withStatus = useMemo(() => applications.map((a) => ({ app: a, status: statusOf(a, now) })), [applications, now]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: withStatus.length };
    for (const { status } of withStatus) c[status] = (c[status] ?? 0) + 1;
    return c;
  }, [withStatus]);
  const shown = withStatus.filter(({ status }) => filter === "all" || filter === "blocks" || status === filter);

  return (
    <div className="flex flex-col gap-4" data-testid="applications-panel">
      {config && !config.turnstileSecretConfigured && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Applications aren&apos;t protected by a CAPTCHA.</strong> Cloudflare Turnstile isn&apos;t configured (<code>TURNSTILE_SECRET_KEY</code> on the server, <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> for the form),
            so only the honeypot, timing check, rate limits and disposable-email filter are running. See docs/DEPLOYMENT.md.
          </div>
        </div>
      )}
      {config && config.turnstileSecretConfigured && !config.turnstileSiteKeyConfigured && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>The CAPTCHA can&apos;t be shown.</strong> The server expects a Turnstile token but <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> isn&apos;t set, so every application will be refused until it is.
          </div>
        </div>
      )}
      {config && !config.emailConfigured && (
        <div className="flex items-start gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 py-3 text-xs text-[var(--muted-foreground)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>Email isn&apos;t configured (<code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code>), so applicants and you won&apos;t get emails. Everything still shows in the app.</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Application status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "min-h-10 rounded-full border px-3.5 text-sm font-medium transition-colors",
              filter === f.id ? "border-transparent text-[var(--color-primary-foreground)]" : "border-[var(--glass-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
            style={filter === f.id ? { background: "var(--theme-gradient)" } : undefined}
          >
            {f.label}
            {f.id !== "blocks" && counts[f.id] ? <span className="ml-1.5 tabular-nums opacity-80">{counts[f.id]}</span> : f.id === "blocks" && blocks.length > 0 ? <span className="ml-1.5 tabular-nums opacity-80">{blocks.length}</span> : null}
          </button>
        ))}
      </div>

      {filter === "blocks" ? (
        <BlockList />
      ) : !loaded ? (
        <div className="glass-card h-24 animate-pulse" />
      ) : shown.length === 0 ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">{filter === "pending" ? "No applications are waiting." : "Nothing here."}</GlassPanel>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map(({ app, status }) => (
            <ApplicationRow key={app.id} app={app} status={status} open={openId === app.id} onToggle={() => setOpenId(openId === app.id ? null : app.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function statusVariant(status: ApplicationStatus): "success" | "danger" | "warning" | "glass" {
  return status === "approved" ? "success" : status === "rejected" || status === "blocked" ? "danger" : status === "expired" ? "warning" : "glass";
}

function ApplicationRow({ app, status, open, onToggle }: { app: TeamApplication; status: ApplicationStatus; open: boolean; onToggle: () => void }) {
  const detail = useApplicationPrivate(open ? app.id : null);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"approve" | "reject" | "block" | null>(null);
  const [reason, setReason] = useState("");
  const [blockEmail, setBlockEmail] = useState(true);
  const [blockTeam, setBlockTeam] = useState(false);
  const actionable = status === "pending";
  const noteText = notes ?? detail?.notes ?? "";

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      setDialog(null);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="glass-card overflow-hidden" data-testid="application-row" data-status={status}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left outline-none hover:bg-white/5 focus-visible:bg-white/5">
        <span className="text-lg font-semibold tabular-nums">FTC {app.teamNumber}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)]">
          {app.teamName || "No name"} · {app.applicantName} · {getRole(app.role).label}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">{fmt(app.createdAtMs)}</span>
        <Badge variant={statusVariant(status)}>{APPLICATION_STATUS_LABEL[status]}</Badge>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="flex flex-col gap-5 border-t border-[var(--glass-border)] p-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Field label="Applicant">{app.applicantName}</Field>
            <Field label="Email">{app.applicantEmail}</Field>
            <Field label="Team">
              FTC {app.teamNumber}
              {app.teamName ? ` · ${app.teamName}` : ""}
              {app.officialTeamName && app.officialTeamName !== app.teamName ? <span className="text-[var(--muted-foreground)]"> (FIRST: {app.officialTeamName})</span> : null}
            </Field>
            <Field label="Role">{getRole(app.role).label}</Field>
            <Field label="Submitted">{fmt(app.createdAtMs)}</Field>
            <Field label={status === "pending" || status === "expired" ? "Expires" : "Decided"}>{status === "pending" || status === "expired" ? fmt(app.expiresAtMs) : fmt(app.decidedAtMs)}</Field>
            {app.link && (
              <Field label="Link">
                <a href={app.link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all underline underline-offset-4">
                  {app.link} <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </Field>
            )}
          </dl>

          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">How they can be verified</div>
            <p className="glass-card mt-1 whitespace-pre-wrap rounded-xl p-3 text-sm">{app.verification}</p>
          </div>

          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Verification signals</div>
            {!detail ? (
              <div className="mt-2 h-8 animate-pulse rounded-xl bg-white/5" />
            ) : detail.signals ? (
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="signals">
                {describeSignals(detail.signals).map((s) => (
                  <li key={s.label} title={s.detail || undefined} className={cn("rounded-full border px-3 py-1 text-xs font-medium", TONE_CLASS[s.tone])}>
                    {s.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">No signals were recorded for this application.</p>
            )}
          </div>

          {status === "rejected" || status === "blocked" ? (
            app.rejectionReason && (
              <div className="text-sm">
                <span className="text-[var(--muted-foreground)]">Reason given: </span>
                {app.rejectionReason}
              </div>
            )
          ) : null}

          <div>
            <Label htmlFor={`notes-${app.id}`}>Private notes (the applicant never sees these)</Label>
            <Textarea id={`notes-${app.id}`} rows={2} maxLength={APPLICATION_LIMITS.notes} value={noteText} onChange={(e) => setNotes(e.target.value)} />
            <Button
              size="sm"
              variant="glass"
              className="mt-2"
              disabled={busy !== null || notes === null || notes === (detail?.notes ?? "")}
              onClick={() => run("note", () => decideApplication({ action: "note", applicationId: app.id, notes: noteText }).then(() => setNotes(null)))}
            >
              {busy === "note" ? "Saving…" : "Save notes"}
            </Button>
          </div>

          {actionable && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] pt-4">
              <Button className="gap-2" disabled={busy !== null} onClick={() => setDialog("approve")}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button variant="glass" className="gap-2" disabled={busy !== null} onClick={() => setDialog("reject")}>
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button variant="ghost" className="gap-2 text-red-300" disabled={busy !== null} onClick={() => setDialog("block")}>
                <ShieldBan className="h-4 w-4" /> Block
              </Button>
            </div>
          )}
          {error && !dialog && (
            <p role="alert" className="text-sm font-medium text-red-300">
              {error}
            </p>
          )}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(next) => !busy && !next && setDialog(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,480px)]">
          {dialog === "approve" && (
            <>
              <DialogTitle>Approve FTC {app.teamNumber}?</DialogTitle>
              <DialogDescription>
                This creates the team&apos;s account now and makes {app.applicantName} its owner and an admin. It can&apos;t be undone from here (an owner can transfer ownership later).
              </DialogDescription>
            </>
          )}
          {dialog === "reject" && (
            <>
              <DialogTitle>Reject this application</DialogTitle>
              <DialogDescription>{app.applicantName} will see your reason, so keep it kind and specific. They can apply again.</DialogDescription>
              <div className="mt-4">
                <Label htmlFor={`reason-${app.id}`}>Reason</Label>
                <Textarea id={`reason-${app.id}`} rows={3} maxLength={APPLICATION_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: we couldn't match you to this team. Please link your team page." />
              </div>
            </>
          )}
          {dialog === "block" && (
            <>
              <DialogTitle>Block and reject</DialogTitle>
              <DialogDescription>This ends the application and stops future applications that use:</DialogDescription>
              <div className="mt-4 flex flex-col gap-3">
                <label className="glass-card flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2">
                  <Checkbox checked={blockEmail} onCheckedChange={(v) => setBlockEmail(v === true)} aria-label="Block this email" />
                  <span className="text-sm">
                    The email <strong>{app.applicantEmail}</strong> (and its +tag / dot variants)
                  </span>
                </label>
                <label className="glass-card flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2">
                  <Checkbox checked={blockTeam} onCheckedChange={(v) => setBlockTeam(v === true)} aria-label="Block this team number" />
                  <span className="text-sm">
                    The team number <strong>FTC {app.teamNumber}</strong>
                  </span>
                </label>
                <div>
                  <Label htmlFor={`block-reason-${app.id}`}>Private reason (optional)</Label>
                  <Textarea id={`block-reason-${app.id}`} rows={2} maxLength={APPLICATION_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-300">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy !== null}>
              Cancel
            </Button>
            {dialog === "approve" && (
              <Button disabled={busy !== null} className="min-w-32 gap-2" onClick={() => run("approve", () => decideApplication({ action: "approve", applicationId: app.id }))}>
                {busy === "approve" && <Loader2 className="h-4 w-4 animate-spin" />} Approve
              </Button>
            )}
            {dialog === "reject" && (
              <Button variant="danger" disabled={busy !== null || reason.trim().length < 3} className="min-w-32 gap-2" onClick={() => run("reject", () => decideApplication({ action: "reject", applicationId: app.id, reason }))}>
                {busy === "reject" && <Loader2 className="h-4 w-4 animate-spin" />} Reject
              </Button>
            )}
            {dialog === "block" && (
              <Button variant="danger" disabled={busy !== null || (!blockEmail && !blockTeam)} className="min-w-32 gap-2" onClick={() => run("block", () => decideApplication({ action: "block", applicationId: app.id, blockEmail, blockTeam, reason }))}>
                {busy === "block" && <Loader2 className="h-4 w-4 animate-spin" />} Block
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function BlockList() {
  const blocks = useApplicationBlocks(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (blocks.length === 0) return <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">Nothing is blocked.</GlassPanel>;
  return (
    <ul className="flex flex-col gap-2">
      {blocks.map((b) => (
        <li key={b.id} className="glass-card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <Badge variant="outline">{b.type === "email" ? "Email" : "Team number"}</Badge>
          <span className="min-w-0 flex-1 truncate font-medium">{b.type === "team" ? `FTC ${b.value}` : b.value}</span>
          {b.reason && <span className="truncate text-xs text-[var(--muted-foreground)]">{b.reason}</span>}
          <Button
            size="sm"
            variant="glass"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(b.id);
              setError(null);
              try {
                await decideApplication({ action: "unblock", blockId: b.id });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't unblock.");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === b.id ? "Removing…" : "Unblock"}
          </Button>
        </li>
      ))}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </ul>
  );
}

"use client";

import Link from "next/link";
import { CheckCircle2, Clock, XCircle, TimerOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { APPLICATION_STATUS_LABEL, applicantFacingStatus } from "@/lib/applications";
import { statusOf, type TeamApplication } from "@/lib/applications-client";
import { getRole } from "@/lib/roles";

const fmt = (ms: number | null) => (ms === null ? "just now" : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));

/**
 * P20: the applicant's Application status page: pending (with when it expires), approved (a way in), rejected (with the
 * reason), or expired. A block is shown as a rejection. Shown on /apply and, for anyone with an application but no team
 * yet, in place of the join screen whenever they sign in.
 */
export function ApplicationStatusCard({
  application,
  onApplyAgain,
  onJoinInstead,
  nowMs,
}: {
  application: TeamApplication;
  onApplyAgain?: () => void;
  onJoinInstead?: () => void;
  nowMs?: number;
}) {
  const status = applicantFacingStatus(statusOf(application, nowMs));
  const icon =
    status === "approved" ? <CheckCircle2 className="h-6 w-6 text-emerald-300" /> : status === "rejected" ? <XCircle className="h-6 w-6 text-red-300" /> : status === "expired" ? <TimerOff className="h-6 w-6 text-amber-300" /> : <Clock className="h-6 w-6 text-sky-300" />;

  return (
    <GlassPanel strong className="flex flex-col gap-5" data-testid="application-status" data-status={status}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Your application</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            FTC {application.teamNumber}
            {application.teamName ? ` · ${application.teamName}` : ""}
          </p>
        </div>
        <Badge variant={status === "approved" ? "success" : status === "rejected" ? "danger" : status === "expired" ? "warning" : "glass"} className="ml-auto shrink-0">
          {APPLICATION_STATUS_LABEL[status]}
        </Badge>
      </div>

      {status === "pending" && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Thanks, we have your application. The platform owner reviews every one by hand, so it can take a little while. You can close this page: it will be here
            whenever you sign in{`, and we'll email you when there's a decision`}.
          </p>
          <p className="text-[var(--muted-foreground)]">
            Submitted {fmt(application.createdAtMs)}. Applications that aren&apos;t reviewed expire on {fmt(application.expiresAtMs)}.
          </p>
        </div>
      )}

      {status === "approved" && (
        <div className="flex flex-col gap-3 text-sm">
          <p>Your application was approved and your team&apos;s account has been created. You&apos;re its owner and an admin.</p>
          <Link href="/dashboard">
            <Button size="lg" className="w-full">
              Continue to your dashboard
            </Button>
          </Link>
        </div>
      )}

      {status === "rejected" && (
        <div className="flex flex-col gap-3 text-sm">
          <p>This application wasn&apos;t approved.</p>
          {application.rejectionReason && (
            <div className="glass-card rounded-xl p-3.5">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Reason</div>
              <p className="mt-1 whitespace-pre-wrap">{application.rejectionReason}</p>
            </div>
          )}
          <p className="text-[var(--muted-foreground)]">If that&apos;s something you can fix, you&apos;re welcome to apply again.</p>
        </div>
      )}

      {status === "expired" && <p className="text-sm">This application expired before it was reviewed. You can apply again.</p>}

      <dl className="grid grid-cols-2 gap-3 border-t border-[var(--glass-border)] pt-4 text-xs">
        <div>
          <dt className="text-[var(--muted-foreground)]">Your role</dt>
          <dd className="font-medium">{getRole(application.role).label}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted-foreground)]">Email</dt>
          <dd className="truncate font-medium">{application.applicantEmail}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {(status === "rejected" || status === "expired") && onApplyAgain && (
          <Button onClick={onApplyAgain} className="min-w-40">
            Apply again
          </Button>
        )}
        {status !== "approved" && onJoinInstead && (
          <Button variant="ghost" onClick={onJoinInstead}>
            Join a team with a code instead
          </Button>
        )}
      </div>
    </GlassPanel>
  );
}

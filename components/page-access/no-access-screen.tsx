"use client";

import Link from "next/link";
import { Check, Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";

/** Where this person's request for the page stands. */
export type RequestStatus = "none" | "pending" | "denied" | "approved";

/**
 * P26: what a person sees at the URL of a page they can't open (instead of an error or a blank page): who it's for, a
 * "Request access" button that creates a request the admins see in Admin Panel > Page Access, and a way back. An
 * admin-only page offers no request (nothing an admin could grant).
 */
export function NoAccessScreen({
  pageTitle,
  adminOnly,
  status,
  sending,
  error,
  onRequest,
}: {
  pageTitle: string;
  adminOnly: boolean;
  status: RequestStatus;
  sending: boolean;
  error: string | null;
  onRequest: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-10" data-testid="no-access">
      <GlassPanel strong className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8">
          <Lock className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">You don&apos;t have access to {pageTitle}</h1>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          {adminOnly ? "This page is only for admins." : "Pages like this one are limited to certain roles. Ask an admin to open it for you and they'll see your request in the Admin Panel."}
        </p>

        {!adminOnly && status === "pending" && (
          <p role="status" data-testid="request-pending" className="flex items-center gap-1.5 text-sm text-emerald-300">
            <Check className="h-4 w-4" aria-hidden /> Request sent. An admin will take a look.
          </p>
        )}
        {!adminOnly && status === "approved" && (
          <p role="status" data-testid="request-approved" className="text-sm text-emerald-300">
            Your request was approved. Reload the page to open it.
          </p>
        )}
        {!adminOnly && status === "denied" && (
          <p role="status" data-testid="request-denied" className="text-sm text-[var(--muted-foreground)]">
            Your last request wasn&apos;t approved. You can ask again.
          </p>
        )}
        {error && (
          <p role="alert" data-testid="request-error" className="text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {!adminOnly && status !== "pending" && status !== "approved" && (
            <Button onClick={onRequest} disabled={sending} className="gap-2" data-testid="request-access">
              <Send className="h-4 w-4" aria-hidden /> {sending ? "Sending…" : "Request access"}
            </Button>
          )}
          <Link href="/dashboard">
            <Button variant="glass">Back to the dashboard</Button>
          </Link>
        </div>
      </GlassPanel>
    </div>
  );
}

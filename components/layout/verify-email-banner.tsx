"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Gentle (per-session, not persisted) nudge for password-signup users who
 * haven't verified yet. Never blocks normal scouting — only owner/admin
 * auto-grants require verification (P1b, see app/api/auth/sync-roles). Google
 * accounts are inherently verified, so this never shows for them.
 *
 * FIX2: when the account's email is the owner's (OWNER_EMAILS) the message says
 * so plainly — "Verify your email to activate owner access" — instead of owner
 * controls just being absent, and adds an "I've verified" button that
 * re-checks without a sign-out.
 */
export function VerifyEmailBanner({ className }: { className?: string }) {
  const { user, resendVerificationEmail, ownerPendingVerification, recheckOwnerAccess } = useAuth();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);

  const isPasswordUser = user?.providerData.some((p) => p.providerId === "password") ?? false;
  if (!user || user.emailVerified || !(isPasswordUser || ownerPendingVerification)) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      await resendVerificationEmail();
      setSent(true);
    } catch {
      // Firebase rate-limits repeated sends — failing silently here is fine, the button just stays clickable to retry.
    } finally {
      setSending(false);
    }
  };

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await recheckOwnerAccess();
    } catch {
      // Offline or rate-limited: the banner simply stays, and the button can be tried again.
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 self-start rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs font-medium text-sky-300",
        className
      )}
    >
      <MailWarning className="h-4 w-4 shrink-0" />
      <span>{ownerPendingVerification ? "Verify your email to activate owner access." : "Verify your email to unlock owner/admin access tied to it."}</span>
      <button type="button" onClick={handleResend} disabled={sending} className="underline underline-offset-4 hover:text-sky-200">
        {sent ? "Sent — check your inbox" : sending ? "Sending…" : "Resend email"}
      </button>
      {ownerPendingVerification && (
        <button type="button" onClick={handleRecheck} disabled={checking} className="underline underline-offset-4 hover:text-sky-200">
          {checking ? "Checking…" : "I've verified — refresh"}
        </button>
      )}
    </div>
  );
}

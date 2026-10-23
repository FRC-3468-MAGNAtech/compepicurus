"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Gentle, dismissible-feeling (per-session, not persisted) nudge for
 * password-signup users who haven't verified yet. Never blocks normal
 * scouting — only owner/admin auto-grants require verification (P1b,
 * see app/api/auth/sync-roles). Google accounts are inherently verified, so
 * this never shows for them.
 */
export function VerifyEmailBanner({ className }: { className?: string }) {
  const { user, resendVerificationEmail } = useAuth();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const isPasswordUser = user?.providerData.some((p) => p.providerId === "password") ?? false;
  if (!user || user.emailVerified || !isPasswordUser) return null;

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

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 self-start rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs font-medium text-sky-300",
        className
      )}
    >
      <MailWarning className="h-4 w-4 shrink-0" />
      <span>Verify your email to unlock owner/admin access tied to it.</span>
      <button type="button" onClick={handleResend} disabled={sending} className="underline underline-offset-4 hover:text-sky-200">
        {sent ? "Sent — check your inbox" : sending ? "Sending…" : "Resend email"}
      </button>
    </div>
  );
}

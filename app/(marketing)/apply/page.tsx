"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/auth/google-button";
import { ApplyForm } from "@/components/applications/apply-form";
import { ApplicationStatusCard } from "@/components/applications/application-status-card";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase/client";
import { useMyApplications, statusOf } from "@/lib/applications-client";

/**
 * P20: /apply, the public entry for "Apply to create a team" (team creation itself stays switched off). In order:
 * not signed in (sign in or create an account first), signed in but email not verified (verify first: the server
 * requires it), then the application form, then (once one exists) the Application status page. Someone who already
 * belongs to a team account is pointed at their dashboard.
 */
export default function ApplyPage() {
  const router = useRouter();
  const { user, profile, loading, loginWithGoogle, resendVerificationEmail, recheckOwnerAccess } = useAuth();
  const { applications, loaded } = useMyApplications(user?.uid ?? null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [applyingAgain, setApplyingAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const emailVerified = verified ?? user?.emailVerified ?? false;
  const latest = applications[0] ?? null;

  // An approved applicant's profile appears moments after approval: take them in.
  useEffect(() => {
    if (!loading && user && profile && latest && statusOf(latest) === "approved") router.replace("/dashboard");
  }, [loading, user, profile, latest, router]);

  const recheck = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await recheckOwnerAccess(); // reloads the account and refreshes the ID token, which is what the server reads
      const nowVerified = auth.currentUser?.emailVerified ?? false;
      setVerified(nowVerified);
      if (!nowVerified) setNotice("We still don't see it as verified. Click the link in the email we sent, then try again.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await resendVerificationEmail();
      setNotice("Sent. Check your inbox (and spam).");
    } catch {
      setNotice("Couldn't send that right now. Wait a minute and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : "Couldn't sign in with Google.");
    } finally {
      setBusy(false);
    }
  };

  let content: React.ReactNode;
  if (loading || (user && !loaded)) {
    content = <div className="glass-card h-64 animate-pulse" />;
  } else if (!user) {
    content = (
      <GlassPanel strong className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Apply to create a team</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            First, sign in or create an account. We need a verified email address to review your application, and Google sign-in counts as verified.
          </p>
        </div>
        <GoogleButton onClick={handleGoogle} disabled={busy} label="Continue with Google" />
        {googleError && <p className="text-sm text-red-300">{googleError}</p>}
        <div className="flex flex-wrap gap-2">
          <Link href="/signup" className="flex-1">
            <Button variant="glass" className="w-full">
              Create an account
            </Button>
          </Link>
          <Link href="/login" className="flex-1">
            <Button variant="ghost" className="w-full">
              Log in
            </Button>
          </Link>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">After you sign up, choose &ldquo;Apply to create a team&rdquo; and we&apos;ll bring you back here.</p>
      </GlassPanel>
    );
  } else if (profile) {
    content = (
      <GlassPanel strong className="flex flex-col gap-4 text-center">
        <h1 className="text-xl font-semibold">You&apos;re already on a team</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Your account already belongs to a team, so there&apos;s nothing to apply for.</p>
        <Link href="/dashboard">
          <Button size="lg" className="w-full">
            Go to your dashboard
          </Button>
        </Link>
      </GlassPanel>
    );
  } else if (!emailVerified) {
    content = (
      <GlassPanel strong className="flex flex-col gap-5" data-testid="verify-email">
        <div className="flex items-start gap-3">
          <MailCheck className="mt-0.5 h-6 w-6 shrink-0 text-sky-300" />
          <div>
            <h1 className="text-xl font-semibold">Verify your email first</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              We sent a link to <strong className="text-[var(--foreground)]">{user.email}</strong>. Click it, then come back and continue. Applications need a verified address so we can reach you.
            </p>
          </div>
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={recheck} disabled={busy} className="min-w-48">
            I&apos;ve verified, continue
          </Button>
          <Button variant="glass" onClick={resend} disabled={busy}>
            Resend the email
          </Button>
        </div>
      </GlassPanel>
    );
  } else if (latest && !applyingAgain) {
    content = (
      <ApplicationStatusCard
        application={latest}
        onApplyAgain={() => setApplyingAgain(true)}
        onJoinInstead={() => router.push("/finish-setup")}
      />
    );
  } else {
    content = <ApplyForm email={user.email ?? ""} defaultName={user.displayName ?? ""} onSubmitted={() => setApplyingAgain(false)} />;
  }

  return <div className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center py-12">
    <div className="w-full">{content}</div>
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/auth/google-button";
import { TeamEnrollmentFields, TeamEnrollmentScreen, useTeamEnrollment } from "@/components/auth/team-enrollment";
import { useAuth } from "@/lib/auth";
import { cardEntranceVariants } from "@/lib/motion";

function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/email-already-in-use":
      return "That email already has an account — try logging in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    default:
      return err instanceof Error ? err.message : "Something went wrong creating your account.";
  }
}

export default function SignupPage() {
  const router = useRouter();
  const {
    user,
    profile,
    loading,
    signup,
    loginWithGoogle,
    firebaseReady,
    pendingGoogleLink,
    completeGoogleLink,
    dismissGoogleLinkPrompt,
  } = useAuth();
  const enrollment = useTeamEnrollment();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkPassword, setLinkPassword] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user && profile) router.replace("/dashboard");
  }, [loading, user, profile, router]);

  // Google created the account but there's no profile yet — hand off to the
  // same join/create screen Finish Setup uses, instead of duplicating it.
  if (!loading && user && !profile) {
    return <TeamEnrollmentScreen greeting={user.displayName ? `Hi, ${user.displayName}` : undefined} onComplete={() => router.push("/dashboard")} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(name, email, password);
      await enrollment.enroll(name);
      router.push("/dashboard");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle();
      // Success routes through the `user && !profile` branch above (or
      // straight to /dashboard if sync-roles' owner auto-attach applied).
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleCompleteLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLinkSubmitting(true);
    try {
      await completeGoogleLink(linkPassword);
      setLinkPassword("");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLinkSubmitting(false);
    }
  };

  if (pendingGoogleLink) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center py-16">
        <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" className="w-full max-w-sm">
          <GlassPanel strong className="flex flex-col gap-6">
            <div className="text-center">
              <h1 className="text-2xl font-semibold">Account already exists</h1>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                <strong>{pendingGoogleLink.email}</strong> already has a password account. Sign in with your password to link
                Google to it.
              </p>
            </div>
            <form onSubmit={handleCompleteLink} className="flex flex-col gap-4">
              <div>
                <Label htmlFor="link-password">Password</Label>
                <Input
                  id="link-password"
                  type="password"
                  value={linkPassword}
                  onChange={(e) => setLinkPassword(e.target.value)}
                  placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                  required
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" size="lg" className="mt-1" disabled={linkSubmitting}>
                {linkSubmitting ? "Linking…" : "Sign in and link Google"}
              </Button>
              <Button type="button" variant="ghost" onClick={dismissGoogleLinkPrompt}>
                Cancel
              </Button>
            </form>
          </GlassPanel>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-16">
      <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" className="w-full max-w-sm">
        <GlassPanel strong className="flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Join the team</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Create your CompEpicurus scouting account.
            </p>
          </div>

          {!firebaseReady && (
            <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-center text-xs text-amber-300">
              Firebase isn&apos;t configured yet &mdash; add your project&apos;s keys to .env.local.
            </p>
          )}

          <GoogleButton onClick={handleGoogle} disabled={googleSubmitting || !firebaseReady} label="Continue with Google" />

          <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
            <div className="h-px flex-1 bg-[var(--glass-border)]" />
            or
            <div className="h-px flex-1 bg-[var(--glass-border)]" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" required />
            </div>
            <div>
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@compepicurus.org"
                required
              />
            </div>
            <div>
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                minLength={6}
                required
              />
            </div>

            <TeamEnrollmentFields enrollment={enrollment} />

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button type="submit" size="lg" className="mt-2 gap-2" disabled={submitting || !firebaseReady}>
              <UserPlus className="h-4 w-4" /> {submitting ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="text-center text-sm text-[var(--muted-foreground)]">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[var(--foreground)] underline underline-offset-4">
              Log in
            </Link>
          </p>
        </GlassPanel>
      </motion.div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogIn } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/auth/google-button";
import { useAuth } from "@/lib/auth";
import { cardEntranceVariants } from "@/lib/motion";

function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email or password doesn't match an account.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a bit.";
    default:
      return err instanceof Error ? err.message : "Something went wrong logging in.";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    profile,
    loading,
    login,
    loginWithGoogle,
    resetPassword,
    firebaseReady,
    pendingGoogleLink,
    completeGoogleLink,
    dismissGoogleLinkPrompt,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [linkPassword, setLinkPassword] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    router.replace(profile ? "/dashboard" : "/finish-setup");
  }, [loading, user, profile, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetSent(false);
    setSubmitting(true);
    try {
      await login(email, password);
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

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Enter your email above first, then click \"Forgot password\".");
      return;
    }
    setError(null);
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
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
            <h1 className="text-2xl font-semibold">Welcome back</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Log in to your CompEpicurus account.
            </p>
          </div>

          {!firebaseReady && (
            <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-center text-xs text-amber-300">
              Firebase isn&apos;t configured yet &mdash; add your project&apos;s keys to .env.local.
            </p>
          )}

          <GoogleButton onClick={handleGoogle} disabled={googleSubmitting || !firebaseReady} />

          <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
            <div className="h-px flex-1 bg-[var(--glass-border)]" />
            or
            <div className="h-px flex-1 bg-[var(--glass-border)]" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@compepicurus.org"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                required
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {resetSent && <p className="text-sm text-emerald-400">Password reset email sent.</p>}

            <button
              type="button"
              onClick={handleForgotPassword}
              className="self-start text-xs text-[var(--muted-foreground)] underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              Forgot password?
            </button>

            <Button type="submit" size="lg" className="mt-2 gap-2" disabled={submitting || !firebaseReady}>
              <LogIn className="h-4 w-4" /> {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>

          <p className="text-center text-sm text-[var(--muted-foreground)]">
            No account?{" "}
            <Link href="/signup" className="font-medium text-[var(--foreground)] underline underline-offset-4">
              Sign up
            </Link>
          </p>
        </GlassPanel>
      </motion.div>
    </div>
  );
}

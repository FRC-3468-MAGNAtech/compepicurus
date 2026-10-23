"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Rocket } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { cardEntranceVariants } from "@/lib/motion";

export default function FirstRunSetupPage() {
  const router = useRouter();
  const { user, firstRunSetup, firebaseReady } = useAuth();
  const { loaded: teamLoaded, exists: teamExists } = useTeamDoc();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);

  // This screen is only for the very first run. Once a team exists — or
  // once we've just created one and are showing its join code below — don't
  // bounce away even if someone else finishes signing up in the meantime.
  useEffect(() => {
    if (user && !joinCode) router.replace("/dashboard");
  }, [user, joinCode, router]);

  useEffect(() => {
    if (teamLoaded && teamExists === true && !joinCode) router.replace("/login");
  }, [teamLoaded, teamExists, joinCode, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedNumber = Number(teamNumber);
    if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
      setError("Enter a valid team number.");
      return;
    }
    setSubmitting(true);
    try {
      const code = await firstRunSetup(name, email, password, parsedNumber);
      setJoinCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong setting up the team.");
    } finally {
      setSubmitting(false);
    }
  };

  if (joinCode) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center py-16">
        <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" className="w-full max-w-sm">
          <GlassPanel strong className="flex flex-col gap-6 text-center">
            <div>
              <h1 className="text-2xl font-semibold">Team created</h1>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Share this join code with the rest of the team so they can sign up.
              </p>
            </div>
            <div className="glass-card rounded-xl px-6 py-4 font-mono text-3xl font-bold tracking-[0.3em]">
              {joinCode}
            </div>
            <Button size="lg" onClick={() => router.push("/dashboard")}>
              Continue to dashboard
            </Button>
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
            <h1 className="text-2xl font-semibold">Set up your team</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              No team exists yet &mdash; create one and become its first admin.
            </p>
          </div>

          {!firebaseReady && (
            <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-center text-xs text-amber-300">
              Firebase isn&apos;t configured yet &mdash; add your project&apos;s keys to .env.local.
            </p>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="team-number">Team number</Label>
              <Input
                id="team-number"
                inputMode="numeric"
                value={teamNumber}
                onChange={(e) => setTeamNumber(e.target.value)}
                placeholder="3468"
                required
              />
            </div>
            <div>
              <Label htmlFor="setup-name">Your name</Label>
              <Input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" required />
            </div>
            <div>
              <Label htmlFor="setup-email">Email</Label>
              <Input
                id="setup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@compepicurus.org"
                required
              />
            </div>
            <div>
              <Label htmlFor="setup-password">Password</Label>
              <Input
                id="setup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                minLength={6}
                required
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button type="submit" size="lg" className="mt-2 gap-2" disabled={submitting || !firebaseReady}>
              <Rocket className="h-4 w-4" /> {submitting ? "Setting up…" : "Create team"}
            </Button>
          </form>
        </GlassPanel>
      </motion.div>
    </div>
  );
}

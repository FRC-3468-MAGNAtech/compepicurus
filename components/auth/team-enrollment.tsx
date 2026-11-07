"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Rocket, Send, UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cardEntranceVariants } from "@/lib/motion";
import { useAuth } from "@/lib/auth";
import { createTeam, fetchTeamCreationEnabled, joinTeam } from "@/lib/team-enrollment";
import { ApplicationStatusCard } from "@/components/applications/application-status-card";
import { useMyApplications } from "@/lib/applications-client";

/** P20: "apply" is how a team gets an account while public creation is switched off: the applicant goes on to /apply. */
export type EnrollmentMode = "join" | "create" | "apply";

/**
 * Shared Join-a-team / Create-a-team state, used by both the Signup page
 * (inline, alongside name/email/password, for the password path) and
 * <TeamEnrollmentScreen/> below (standalone, for an already-authenticated
 * user with no profile yet — Google sign-in's first-time path, or anyone
 * who closed the tab before finishing before). See docs/ASSUMPTIONS.md
 * (P1b) — team creation is locked server-side the moment a team exists;
 * `teamCreationEnabled` is `null` while that's still loading, during which
 * the Create tab is hidden and Join is assumed.
 */
export function useTeamEnrollment() {
  const [mode, setMode] = useState<EnrollmentMode>("join");
  const [joinCode, setJoinCode] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamCreationEnabled, setTeamCreationEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTeamCreationEnabled().then((enabled) => {
      if (!cancelled) setTeamCreationEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enroll = async (name?: string): Promise<{ joinCode?: string; apply?: boolean }> => {
    if (mode === "apply" && teamCreationEnabled === false) return { apply: true };
    if (mode === "join" || !teamCreationEnabled) {
      if (!joinCode.trim()) throw new Error("Enter a join code.");
      await joinTeam(joinCode.trim(), name);
      return {};
    }
    const parsedNumber = Number(teamNumber);
    if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
      throw new Error("Enter a valid team number.");
    }
    const result = await createTeam(parsedNumber, teamName.trim() || undefined, name);
    return { joinCode: result.joinCode };
  };

  return {
    mode,
    setMode,
    joinCode,
    setJoinCode,
    teamNumber,
    setTeamNumber,
    teamName,
    setTeamName,
    teamCreationEnabled,
    enroll,
  };
}

export function TeamEnrollmentFields({ enrollment }: { enrollment: ReturnType<typeof useTeamEnrollment> }) {
  const { mode, setMode, joinCode, setJoinCode, teamNumber, setTeamNumber, teamName, setTeamName, teamCreationEnabled } =
    enrollment;
  const showCreateFields = teamCreationEnabled && mode === "create";
  // P20: with public creation off, the second option is applying (reviewed by the platform owner), not creating.
  const showApply = teamCreationEnabled === false && mode === "apply";

  return (
    <div className="flex flex-col gap-4">
      {teamCreationEnabled && (
        <Tabs value={mode} onValueChange={(v) => setMode(v as EnrollmentMode)}>
          <TabsList>
            <TabsTrigger value="join">Join a team</TabsTrigger>
            <TabsTrigger value="create">Create a team</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {teamCreationEnabled === false && (
        <Tabs value={mode === "apply" ? "apply" : "join"} onValueChange={(v) => setMode(v as EnrollmentMode)}>
          <TabsList>
            <TabsTrigger value="join">Join a team</TabsTrigger>
            <TabsTrigger value="apply">Apply to create a team</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {showApply ? (
        <p className="glass-card rounded-xl p-3.5 text-sm text-[var(--muted-foreground)]" data-testid="apply-explainer">
          New team accounts are approved by hand, one per FTC team. Next you&apos;ll verify your email and tell us about your team. If your team already has an account, join it with a code instead.
        </p>
      ) : showCreateFields ? (
        <>
          <div>
            <Label htmlFor="team-number">Team number</Label>
            <Input
              id="team-number"
              inputMode="numeric"
              value={teamNumber}
              onChange={(e) => setTeamNumber(e.target.value)}
              placeholder="12345"
              required
            />
          </div>
          <div>
            <Label htmlFor="team-name">Team name (optional)</Label>
            <Input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" />
          </div>
        </>
      ) : (
        <div>
          <Label htmlFor="join-code">Join code</Label>
          <Input
            id="join-code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="From a teammate or mentor"
            required
          />
        </div>
      )}
    </div>
  );
}

/**
 * The full "you're signed in, now join or create a team" screen — used
 * standalone by /finish-setup, and rendered in place of Signup's
 * pre-auth form once a Google sign-in there has no profile yet.
 */
export function TeamEnrollmentScreen({
  greeting,
  onComplete,
}: {
  greeting?: string;
  /** Called after a successful join/create (profile now exists — the caller decides where to go, e.g. router.push("/dashboard")). */
  onComplete: () => void;
}) {
  const router = useRouter();
  const { logout, profile, user } = useAuth();
  const enrollment = useTeamEnrollment();
  // P20: anyone who has applied sees their Application status here whenever they sign in, instead of the join form.
  const { applications, loaded: applicationsLoaded } = useMyApplications(user?.uid ?? null);
  const [showJoinInstead, setShowJoinInstead] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdJoinCode, setCreatedJoinCode] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  // Set once join/create has actually succeeded server-side — but the
  // caller's own `profile` (from useAuth's realtime users/{uid} listener)
  // can take a moment to catch up with the doc that write just created.
  // Navigating on success immediately (the old behavior) raced that: if
  // /dashboard's route guard ran before the listener's next snapshot
  // arrived, it would still see `profile: null` and bounce straight back
  // to /finish-setup, only "fixed" by a manual refresh re-subscribing late
  // enough to see the real doc. Waiting for `profile` here closes that gap.
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    if (!enrolled) return;
    if (profile) {
      onComplete();
      return;
    }
    // Fail-safe: proceed anyway if the listener hasn't caught up after a
    // few seconds — no worse than the old always-immediate behavior, and
    // /dashboard's own guard still handles a genuinely missing profile.
    const timeout = setTimeout(onComplete, 5000);
    return () => clearTimeout(timeout);
  }, [enrolled, profile, onComplete]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await enrollment.enroll();
      if (result.apply) {
        router.push("/apply");
        return;
      }
      if (result.joinCode) {
        setCreatedJoinCode(result.joinCode);
        setSubmitting(false);
      } else {
        setEnrolled(true); // stays "submitting" until the effect above navigates
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  if (applicationsLoaded && applications.length > 0 && !showJoinInstead && !createdJoinCode) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center py-16">
        <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" className="w-full max-w-md">
          <ApplicationStatusCard application={applications[0]} onApplyAgain={() => router.push("/apply")} onJoinInstead={() => setShowJoinInstead(true)} />
        </motion.div>
      </div>
    );
  }

  if (createdJoinCode) {
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
            <div className="glass-card rounded-xl px-6 py-4 font-mono text-3xl font-bold tracking-[0.3em]">{createdJoinCode}</div>
            <Button size="lg" onClick={() => setEnrolled(true)} disabled={enrolled}>
              {enrolled ? "Setting up…" : "Continue to dashboard"}
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
            <h1 className="text-2xl font-semibold">Almost there</h1>
            {greeting && <p className="mt-1 text-sm font-medium">{greeting}</p>}
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Join your team with a code, or create one if yours doesn&apos;t exist yet.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TeamEnrollmentFields enrollment={enrollment} />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" size="lg" className="mt-1 gap-2" disabled={submitting}>
              {enrollment.mode === "apply" && enrollment.teamCreationEnabled === false ? (
                <Send className="h-4 w-4" />
              ) : enrollment.mode === "create" && enrollment.teamCreationEnabled ? (
                <Rocket className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {submitting ? "Working…" : enrollment.mode === "apply" && enrollment.teamCreationEnabled === false ? "Continue to application" : enrollment.mode === "create" && enrollment.teamCreationEnabled ? "Create team" : "Join team"}
            </Button>
          </form>

          <p className="text-center text-sm text-[var(--muted-foreground)]">
            Wrong account?{" "}
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="font-medium text-[var(--foreground)] underline underline-offset-4 disabled:opacity-60"
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </p>
        </GlassPanel>
      </motion.div>
    </div>
  );
}

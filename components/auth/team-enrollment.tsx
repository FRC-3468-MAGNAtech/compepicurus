"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Rocket, UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cardEntranceVariants } from "@/lib/motion";
import { createTeam, fetchTeamCreationEnabled, joinTeam } from "@/lib/team-enrollment";

export type EnrollmentMode = "join" | "create";

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

  const enroll = async (name?: string): Promise<{ joinCode?: string }> => {
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

      {showCreateFields ? (
        <>
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
            <Label htmlFor="team-name">Team name (optional)</Label>
            <Input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="MAGNAtech" />
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
  const enrollment = useTeamEnrollment();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdJoinCode, setCreatedJoinCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await enrollment.enroll();
      if (result.joinCode) {
        setCreatedJoinCode(result.joinCode);
      } else {
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

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
            <Button size="lg" onClick={onComplete}>
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
              {enrollment.mode === "create" && enrollment.teamCreationEnabled ? (
                <Rocket className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {submitting ? "Working…" : enrollment.mode === "create" && enrollment.teamCreationEnabled ? "Create team" : "Join team"}
            </Button>
          </form>
        </GlassPanel>
      </motion.div>
    </div>
  );
}

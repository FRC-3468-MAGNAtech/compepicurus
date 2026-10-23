"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { TeamEnrollmentScreen } from "@/components/auth/team-enrollment";

/**
 * Lands a signed-in user with no profile doc yet here — almost always a
 * first-time Google sign-in (see lib/auth.tsx; password signups enroll
 * inline on the Signup page itself and never have this gap). Replaces P1's
 * `/setup` first-run screen entirely — see docs/ASSUMPTIONS.md (P1b).
 */
export default function FinishSetupPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (profile) router.replace("/dashboard");
  }, [loading, user, profile, router]);

  if (loading || !user || profile) return null;

  return <TeamEnrollmentScreen greeting={user.displayName ? `Hi, ${user.displayName}` : undefined} onComplete={() => router.push("/dashboard")} />;
}

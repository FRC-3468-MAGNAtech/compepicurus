"use client";

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ProfileBody } from "@/components/profile/profile-body";
import { BackLink, ProfileScreen } from "@/components/profile/profile-screen";
import { ProfileActivitySkeleton, ProfileHeaderSkeleton } from "@/components/profile/profile-sections";
import { useActiveEvents } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import type { ProfileDoc } from "@/lib/profile/model";
import { clearProfileText, useProfile } from "@/lib/profile/service";
import { computeProfileStats, eventTargetProgress } from "@/lib/profile/stats";
import { useScoutStatsSources } from "@/lib/scout-stats/use-scout-stats";
import { useScoutTargets } from "@/lib/scout-status/store";
import { useTeamAssignmentSlots } from "@/lib/scout-status/use-assignments";
import { useTeamMembers, type TeamMember } from "@/lib/team-members";

/**
 * A member's profile page (P25), for /people/:uid and /profile (your own).
 *
 * Privacy: the rules decide what can be read (firestore.rules, profiles/{uid}); this page also never mounts the
 * activity section for a private profile, so a non-admin teammate's browser doesn't even load it. The limits are
 * stated honestly in Settings: privacy covers this page and the profile's own text, not the underlying scouting data.
 */
export function ProfileView({ uid }: { uid: string }) {
  const { user, profile: me } = useAuth();
  const teamId = me?.teamId ?? null;
  const { members, loaded: membersLoaded } = useTeamMembers(teamId);
  const state = useProfile(uid, teamId);
  const member = members.find((m) => m.uid === uid) ?? null;
  if (!membersLoaded || state.status === "loading") {
    return (
      <div className="flex flex-col gap-6" data-testid="profile-loading">
        <ProfileHeaderSkeleton />
        <ProfileActivitySkeleton />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <GlassPanel data-testid="profile-not-found" className="py-10 text-center">
          <h1 className="text-lg font-semibold">We couldn&apos;t find that person</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">They may not be on your team, or the link may be out of date.</p>
        </GlassPanel>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <GlassPanel data-testid="profile-error" className="py-10 text-center text-sm text-[var(--muted-foreground)]">
          Couldn&apos;t load this profile. Check your connection and reload the page.
        </GlassPanel>
      </div>
    );
  }

  const profile = state.status === "ready" ? state.profile : null;

  return (
    <ProfileScreen
      key={uid}
      member={member}
      profile={profile}
      denied={state.status === "denied"}
      viewer={{ uid: user?.uid ?? "", isAdmin: !!me?.isAdmin }}
      renderFull={({ canModerate, isSelf }) => <ProfileFull key={uid} member={member} profile={profile} teamId={teamId} isSelf={isSelf} canModerate={canModerate} />}
    />
  );
}

/** The part that loads the team's scouting data: only mounted when the viewer may see this profile. */
function ProfileFull({ member, profile, teamId, isSelf, canModerate }: { member: TeamMember; profile: ProfileDoc | null; teamId: string | null; isSelf: boolean; canModerate: boolean }) {
  const { user, profile: me } = useAuth();
  const sources = useScoutStatsSources(teamId);
  const { events: activeEvents, primaryCode } = useActiveEvents();
  const targets = useScoutTargets(teamId);
  const { slotsByEvent, loaded: slotsLoaded } = useTeamAssignmentSlots(teamId);
  // Fixed once per visit: "5 minutes ago" doesn't need to tick, and a render shouldn't read the clock.
  const [nowMs] = useState(() => Date.now());

  const stats = useMemo(
    () =>
      sources.loaded
        ? computeProfileStats({ uid: member.uid, members: sources.members, sessions: sources.sessions, entries: sources.entries, libraryMatchesById: sources.libraryMatchesById, attendance: sources.attendance, now: new Date(nowMs) })
        : null,
    [sources.loaded, sources.members, sources.sessions, sources.entries, sources.libraryMatchesById, sources.attendance, member.uid, nowMs]
  );

  const eventName = (code: string) => activeEvents.find((e) => e.code === code)?.name ?? code;
  const ready = stats !== null && targets.loaded && slotsLoaded;

  // The event whose target to show: the primary active one, when this member is part of it (attending, has entries or a target).
  const target = useMemo(() => {
    if (!ready || !stats || !primaryCode) return null;
    const progress = eventTargetProgress({ uid: member.uid, eventCode: primaryCode, entries: sources.entries, setup: targets.setups.get(primaryCode) ?? null, slots: slotsByEvent.get(primaryCode) });
    const involved = progress.target !== null || progress.entries > 0 || stats.events.some((e) => e.eventCode === primaryCode);
    return involved ? progress : null;
  }, [ready, primaryCode, member.uid, sources.entries, targets.setups, slotsByEvent, stats]);

  return (
    <ProfileBody
      member={member}
      profile={profile}
      isSelf={isSelf}
      stats={ready ? stats : null}
      nowMs={nowMs}
      eventName={eventName}
      target={target}
      targetEventName={primaryCode ? eventName(primaryCode) : null}
      canModerate={canModerate}
      onClear={profile && user && me ? () => clearProfileText({ teamId: me.teamId, uid: user.uid, name: me.name }, { uid: member.uid, name: member.name, bio: profile.bio, pronouns: profile.pronouns }) : undefined}
    />
  );
}

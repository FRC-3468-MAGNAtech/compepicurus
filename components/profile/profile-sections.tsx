"use client";

import Link from "next/link";
import { CalendarCheck, Flag, Flame, Layers, Lock, Medal, ShieldCheck, Sparkles, Target, Trophy, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { MyScoutingCard } from "@/components/scout-stats/my-scouting-card";
import { PlatformBadge } from "@/components/scout-stats/platform-badge";
import { FieldTeamChips } from "@/components/team/field-team-chips";
import { getPercentColor } from "@/lib/accuracy/engine";
import type { ProfileDoc } from "@/lib/profile/model";
import { headerName } from "@/lib/profile/model";
import { monthYear, relativeTime } from "@/lib/profile/format";
import type { BadgeResult } from "@/lib/profile/badges";
import type { CategoryStat, EventEntries, EventTargetProgress, ProfileStats } from "@/lib/profile/stats";
import { getRole, ROLES } from "@/lib/roles";
import type { ScoutCategory } from "@/lib/scout-stats/types";
import type { TeamMember } from "@/lib/team-members";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<ScoutCategory, string> = { trial: "Trial", competitive: "Competitive", "real-event": "Real Event" };

/** What the "This profile is private" card shows a non-admin teammate: avatar, name, primary role. Nothing else — not even a bio's existence. */
export function LimitedProfileCard({ member }: { member: TeamMember }) {
  const primary = getRole(member.primaryRole);
  return (
    <GlassPanel data-testid="profile-limited" className="flex flex-col items-center gap-4 py-10 text-center">
      <Avatar name={member.name} size="xl" avatar={member.avatar} />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{member.name}</h1>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", primary.className)}>{primary.label}</span>
      </div>
      <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Lock className="h-4 w-4" aria-hidden /> This profile is private
      </p>
    </GlassPanel>
  );
}

export function ProfileHeader({
  member,
  profile,
  isSelf,
  stats,
  nowMs,
  actions,
}: {
  member: TeamMember;
  profile: ProfileDoc | null;
  isSelf: boolean;
  /** null while the activity is still loading (the last-active line holds its space). */
  stats: ProfileStats | null;
  nowMs: number;
  actions?: React.ReactNode;
}) {
  const primary = getRole(member.primaryRole);
  const name = headerName(profile, member.name);
  const pronouns = profile?.pronouns?.trim();
  const bio = profile?.bio?.trim();
  return (
    <GlassPanel data-testid="profile-header" className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <Avatar name={name} size="xl" avatar={profile?.avatar ?? member.avatar} className="self-start" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 data-testid="profile-name" className="break-words text-2xl font-semibold tracking-tight">
              {name}
            </h1>
            {pronouns && (
              <p data-testid="profile-pronouns" className="text-sm text-[var(--muted-foreground)]">
                {pronouns}
              </p>
            )}
            {profile?.displayName?.trim() && profile.displayName.trim() !== member.name && <p className="text-xs text-[var(--muted-foreground)]">Account name: {member.name}</p>}
          </div>
          {actions}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", primary.className)}>{primary.label}</span>
          {member.secondaryRoles.map((id) => {
            const r = ROLES.find((role) => role.id === id);
            return r ? (
              <Badge key={id} variant="glass" className="text-[10px]">
                {r.label}
              </Badge>
            ) : null;
          })}
          <FieldTeamChips ids={member.fieldTeamIds} />
          {member.isOwner && (
            <Badge variant="glass" className="gap-1 text-[10px]">
              <ShieldCheck className="h-3 w-3" /> Owner
            </Badge>
          )}
          {member.isAdmin && !member.isOwner && (
            <Badge variant="glass" className="text-[10px]">
              Admin
            </Badge>
          )}
        </div>

        {bio ? (
          <p data-testid="profile-bio" className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">
            {bio}
          </p>
        ) : (
          isSelf && (
            <p data-testid="profile-bio-empty" className="text-sm text-[var(--muted-foreground)]">
              You haven&apos;t written a bio yet.{" "}
              <Link href="/account#privacy-profile" className="underline underline-offset-2">
                Add one
              </Link>
              .
            </p>
          )
        )}

        <div className="flex min-h-5 flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
          {member.joinedAtMs !== undefined && <span data-testid="profile-joined">Joined {monthYear(member.joinedAtMs)}</span>}
          {stats === null ? (
            <Shimmer className="h-4 w-32 rounded-md" />
          ) : (
            <span data-testid="profile-last-active">{stats.lastActiveMs === null ? "No activity yet" : `Last active ${relativeTime(stats.lastActiveMs, nowMs)}`}</span>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{children}</h2>
      {hint}
    </div>
  );
}

function AccuracyCards({ categories }: { categories: CategoryStat[] }) {
  return (
    <section aria-label="Accuracy" className="flex flex-col gap-3">
      <SectionTitle>Accuracy</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {categories.map((c, i) =>
          c.detail && c.detail.sessionsOrForms > 0 ? (
            <div key={c.category} data-testid={`profile-accuracy-${c.category}`}>
              <MyScoutingCard category={c.category} detail={c.detail} rank={c.rank} index={i} />
            </div>
          ) : (
            <GlassPanel key={c.category} data-testid={`profile-accuracy-${c.category}`} className="flex min-h-[148px] flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{CATEGORY_LABELS[c.category]}</span>
              <p className="text-sm text-[var(--muted-foreground)]">{c.category === "real-event" ? "No Real Event entries yet." : `No ${CATEGORY_LABELS[c.category]} sessions yet.`}</p>
            </GlassPanel>
          )
        )}
      </div>
    </section>
  );
}

function PracticeSection({ stats }: { stats: ProfileStats }) {
  return (
    <section aria-label="Practice scouting" className="flex flex-col gap-3">
      <SectionTitle>Practice scouting</SectionTitle>
      <GlassPanel className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-6">
          <div data-testid="profile-session-count">
            <div className="text-2xl font-semibold tabular-nums">{stats.sessionCount}</div>
            <div className="text-xs text-[var(--muted-foreground)]">{stats.sessionCount === 1 ? "session" : "sessions"}</div>
          </div>
          <div data-testid="profile-streak">
            <div className="flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              {stats.streak > 0 && <Flame className="h-5 w-5 text-orange-400" aria-hidden />}
              {stats.streak}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              {stats.streak === 1 ? "day" : "days"} practice streak{stats.longestStreak > stats.streak ? ` · best ${stats.longestStreak}` : ""}
            </div>
          </div>
        </div>
        {stats.recentSessions.length === 0 ? (
          <p data-testid="profile-no-sessions" className="text-sm text-[var(--muted-foreground)]">
            No practice sessions yet.
          </p>
        ) : (
          <ul data-testid="profile-recent-sessions" className="flex flex-col gap-2">
            {stats.recentSessions.map((s) => (
              <li key={s.sessionId} className="glass-card flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{s.matchLabel}</span>
                <PlatformBadge platform={s.platform} />
                {s.excluded && (
                  <Badge variant="outline" className="text-[10px]">
                    Excluded
                  </Badge>
                )}
                <span className={cn("w-12 text-right font-mono tabular-nums", s.accuracy !== null ? getPercentColor(s.accuracy) : "text-[var(--muted-foreground)]")}>{s.accuracy === null ? "?" : `${Math.round(s.accuracy)}%`}</span>
                <span className="w-24 text-right text-xs text-[var(--muted-foreground)]">{s.date ? new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </section>
  );
}

function EventsSection({ events, eventName, target, targetEventName }: { events: EventEntries[]; eventName: (code: string) => string; target: EventTargetProgress | null; targetEventName: string | null }) {
  return (
    <section aria-label="Events" className="flex flex-col gap-3">
      <SectionTitle>Events</SectionTitle>
      <GlassPanel className="flex flex-col gap-4">
        {target && (
          <div data-testid="profile-target" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">Target at {targetEventName ?? target.eventCode}</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                {target.target === null ? `${target.entries} ${target.entries === 1 ? "entry" : "entries"} · no target set` : `${target.entries} of ${target.target} · ${Math.round((target.completion ?? 0) * 100)}%`}
              </span>
            </div>
            {target.target !== null && (
              <div role="progressbar" aria-label="Target completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((target.completion ?? 0) * 100)} className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${Math.round((target.completion ?? 0) * 100)}%`, background: "var(--theme-gradient)" }} />
              </div>
            )}
          </div>
        )}
        {events.length === 0 ? (
          <p data-testid="profile-no-events" className="text-sm text-[var(--muted-foreground)]">
            Hasn&apos;t been marked as attending an event yet.
          </p>
        ) : (
          <>
            <div className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">{events.length}</span> <span className="text-xs text-[var(--muted-foreground)]">{events.length === 1 ? "event attended" : "events attended"}</span>
            </div>
            <ul data-testid="profile-events" className="flex flex-col gap-2">
              {events.map((e) => (
                <li key={e.eventCode} className="glass-card flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="min-w-0 truncate">{eventName(e.eventCode)}</span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {e.entries} {e.entries === 1 ? "entry" : "entries"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </GlassPanel>
    </section>
  );
}

const BADGE_ICONS: Record<string, LucideIcon> = { flag: Flag, layers: Layers, medal: Medal, target: Target, sparkles: Sparkles, flame: Flame, calendar: CalendarCheck, trophy: Trophy };

function BadgesSection({ badges }: { badges: BadgeResult[] }) {
  const earned = badges.filter((b) => b.earned).length;
  return (
    <section aria-label="Achievements" className="flex flex-col gap-3">
      <SectionTitle hint={<span className="text-xs text-[var(--muted-foreground)]">{earned} of {badges.length}</span>}>Achievements</SectionTitle>
      <GlassPanel>
        {earned === 0 && (
          <p data-testid="profile-no-badges" className="mb-3 text-sm text-[var(--muted-foreground)]">
            No achievements yet — they appear as practice and events add up.
          </p>
        )}
        <ul data-testid="profile-badges" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {badges.map(({ badge, earned: isEarned }) => {
            const Icon = BADGE_ICONS[badge.icon] ?? Medal;
            return (
              <li
                key={badge.id}
                data-testid={`badge-${badge.id}`}
                data-earned={isEarned}
                title={badge.description}
                className={cn("glass-card flex flex-col items-center gap-1.5 p-3 text-center", !isEarned && "border border-dashed border-[var(--glass-border)] text-[var(--muted-foreground)]")}
              >
                <span className={cn("flex h-10 w-10 items-center justify-center rounded-full", isEarned ? "text-[var(--color-primary-foreground)]" : "bg-black/5 text-[var(--muted-foreground)] dark:bg-white/10")} style={isEarned ? { background: "var(--theme-gradient)" } : undefined}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-xs font-medium">{badge.label}</span>
                <span className="sr-only">{isEarned ? "Earned." : "Not earned yet."} {badge.description}</span>
              </li>
            );
          })}
        </ul>
      </GlassPanel>
    </section>
  );
}

export function ProfileActivity({ stats, eventName, target, targetEventName }: { stats: ProfileStats; eventName: (code: string) => string; target: EventTargetProgress | null; targetEventName: string | null }) {
  return (
    <div className="flex flex-col gap-6" data-testid="profile-activity">
      <AccuracyCards categories={stats.categories} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PracticeSection stats={stats} />
        <EventsSection events={stats.events} eventName={eventName} target={target} targetEventName={targetEventName} />
      </div>
      <BadgesSection badges={stats.badges} />
    </div>
  );
}

/** Holds the profile's whole shape while its data loads, so nothing jumps when it arrives. */
export function ProfileActivitySkeleton() {
  return (
    <div className="flex flex-col gap-6" data-testid="profile-activity-skeleton" aria-busy="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Shimmer key={i} className="h-[148px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Shimmer className="h-64" />
        <Shimmer className="h-64" />
      </div>
      <Shimmer className="h-40" />
    </div>
  );
}

export function ProfileHeaderSkeleton() {
  return (
    <div data-testid="profile-skeleton">
      <Shimmer className="h-56 sm:h-48" />
    </div>
  );
}

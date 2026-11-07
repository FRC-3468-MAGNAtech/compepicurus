"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CalendarCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useActiveEvents } from "@/lib/active-event";
import { useTeamEventAttendance } from "@/lib/event-attendance";
import { useTeamMembers } from "@/lib/team-members";
import { getRole, ROLES } from "@/lib/roles";
import { FieldTeamChips } from "@/components/team/field-team-chips";
import { ALL_TEAMS, TeamFilterSelect, selectedTeamIds } from "@/components/team/team-filter-select";
import { matchesTeamFilter } from "@/lib/field-teams";
import { useFieldTeams } from "@/lib/field-teams-context";

export default function PeoplePage() {
  const { profile } = useAuth();
  const { members, loaded } = useTeamMembers(profile?.teamId ?? null);
  const { isActive } = useActiveEvents();
  const { attendance } = useTeamEventAttendance(profile?.teamId ?? null);
  // Attending at *any* active event (a team can have several at once).
  const attendingUids = useMemo(
    () => new Set(attendance.filter((a) => isActive(a.eventCode)).flatMap((a) => a.uids)),
    [attendance, isActive]
  );
  const [query, setQuery] = useState("");
  // P19: Team filter (next to the search; hidden when the account has a single FTC team).
  const { fieldTeams } = useFieldTeams();
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const filtered = useMemo(
    () =>
      members.filter(
        (p) => p.name.toLowerCase().includes(query.toLowerCase()) && matchesTeamFilter(p.fieldTeamIds, selectedTeamIds(teamFilter, fieldTeams), fieldTeams)
      ),
    [members, query, teamFilter, fieldTeams]
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Team roster &amp; directory.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TeamFilterSelect value={teamFilter} onChange={setTeamFilter} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people..."
            className="sm:w-64"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!loaded ? (
          <GlassPanel className="sm:col-span-2 lg:col-span-3 h-32 animate-pulse" />
        ) : (
          filtered.map((p) => {
            const primary = getRole(p.primaryRole);
            return (
              <Link key={p.uid} href={`/people/${p.uid}`} aria-label={`View ${p.name}'s profile`} data-testid="person-card" className="block rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
              <GlassPanel interactive className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} size="lg" avatar={p.avatar} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-[var(--muted-foreground)]">{p.email}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${primary.className}`}>{primary.label}</span>
                  {p.secondaryRoles.map((id) => {
                    const r = ROLES.find((role) => role.id === id);
                    if (!r) return null;
                    return (
                      <Badge key={id} variant="glass" className="text-[10px]">
                        {r.label}
                      </Badge>
                    );
                  })}
                  <FieldTeamChips ids={p.fieldTeamIds} />
                  {p.isOwner && (
                    <Badge variant="glass" className="gap-1 text-[10px]">
                      <ShieldCheck className="h-3 w-3" /> Owner
                    </Badge>
                  )}
                  {p.isAdmin && !p.isOwner && (
                    <Badge variant="glass" className="text-[10px]">
                      Admin
                    </Badge>
                  )}
                  {attendingUids.has(p.uid) && (
                    <Badge variant="success" className="gap-1 text-[10px]">
                      <CalendarCheck className="h-3 w-3" /> Attending
                    </Badge>
                  )}
                </div>
              </GlassPanel>
              </Link>
            );
          })
        )}
        {loaded && filtered.length === 0 && (
          <GlassPanel className="sm:col-span-2 lg:col-span-3">
            <p className="text-center text-sm text-[var(--muted-foreground)]">No one matches &ldquo;{query}&rdquo;.</p>
          </GlassPanel>
        )}
      </div>
    </div>
  );
}

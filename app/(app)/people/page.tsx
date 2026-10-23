"use client";

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useTeamMembers } from "@/lib/team-members";
import { getRole, ROLES } from "@/lib/roles";

export default function PeoplePage() {
  const { profile } = useAuth();
  const { members, loaded } = useTeamMembers(profile?.teamId ?? null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => members.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [members, query]
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Team roster &amp; directory.</p>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people..."
          className="sm:w-64"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!loaded ? (
          <GlassPanel className="sm:col-span-2 lg:col-span-3 h-32 animate-pulse" />
        ) : (
          filtered.map((p) => {
            const primary = getRole(p.primaryRole);
            return (
              <GlassPanel key={p.uid} interactive className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} size="lg" />
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
                  {p.isAdmin && (
                    <Badge variant="glass" className="text-[10px]">
                      Admin
                    </Badge>
                  )}
                </div>
              </GlassPanel>
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

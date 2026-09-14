"use client";

import { useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { people } from "@/lib/mock-data";

const subteamColors: Record<string, "accent" | "success" | "warning" | "outline" | "glass"> = {
  Scouting: "accent",
  Programming: "success",
  Mechanical: "warning",
  CAD: "outline",
  Business: "glass",
};

export default function PeoplePage() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [query]
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
        {filtered.map((p) => (
          <GlassPanel key={p.id} interactive className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={p.name} size="lg" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="truncate text-xs text-[var(--muted-foreground)]">{p.role}</div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>{p.grade}</span>
              <Badge variant={subteamColors[p.subteam] ?? "glass"}>{p.subteam}</Badge>
            </div>
            <div className="truncate text-xs text-[var(--muted-foreground)]">{p.email}</div>
          </GlassPanel>
        ))}
        {filtered.length === 0 && (
          <GlassPanel className="sm:col-span-2 lg:col-span-3">
            <p className="text-center text-sm text-[var(--muted-foreground)]">No one matches &ldquo;{query}&rdquo;.</p>
          </GlassPanel>
        )}
      </div>
    </div>
  );
}

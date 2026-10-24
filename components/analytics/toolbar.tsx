"use client";

import { Search } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GAMES } from "@/lib/analytics/game-schema";

export function AnalyticsToolbar({
  entryCount,
  search,
  onSearchChange,
  autoExpand,
  onAutoExpandChange,
  hideNames,
  onHideNamesChange,
  gameId,
  onGameChange,
}: {
  entryCount: number;
  search: string;
  onSearchChange: (v: string) => void;
  autoExpand: boolean;
  onAutoExpandChange: (v: boolean) => void;
  hideNames: boolean;
  onHideNamesChange: (v: boolean) => void;
  gameId: string;
  onGameChange: (v: string) => void;
}) {
  return (
    <GlassPanel className="flex flex-wrap items-center gap-4">
      <span className="text-sm font-semibold whitespace-nowrap">
        {entryCount} {entryCount === 1 ? "entry" : "entries"}
      </span>

      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search this analytics page..."
          className="pl-10"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={autoExpand} onCheckedChange={(v) => onAutoExpandChange(v === true)} />
        Auto-expand notes
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={hideNames} onCheckedChange={(v) => onHideNamesChange(v === true)} />
        Hide Names
      </label>

      <Select value={gameId} onValueChange={onGameChange}>
        <SelectTrigger className="w-40">
          <SelectValue>{GAMES[gameId]?.name}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.values(GAMES).map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </GlassPanel>
  );
}

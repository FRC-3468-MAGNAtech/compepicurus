"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarX2, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { GlassSkeletonCard } from "@/components/ui/glass-skeleton";
import { BracketPicker } from "@/components/scout/bracket-picker";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import { getMatchesForEvent } from "@/lib/ftc/actions";
import type { FtcEvent, FtcMatch, MatchType } from "@/lib/ftc/types";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";

export type AssignedMatch = { type: MatchType; match: FtcMatch };

const TABS: { value: MatchType; label: string }[] = [
  { value: "Practice", label: "Practice" },
  { value: "Qualification", label: "Qualification" },
  { value: "Playoff", label: "Finals" },
];

export function MatchPickerDialog({
  open,
  onOpenChange,
  activeEvent,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeEvent: FtcEvent | null;
  onSelect: (assigned: AssignedMatch) => void;
}) {
  const [tab, setTab] = useState<MatchType>("Qualification");

  const choose = (assigned: AssignedMatch) => {
    onSelect(assigned);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(95vw,820px)] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Pick a match</DialogTitle>
        <DialogDescription>Choose the match type, then tap the match you&apos;re scouting.</DialogDescription>

        {!activeEvent ? (
          <NoActiveEvent />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as MatchType)} className="mt-4 flex flex-col gap-4">
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="Practice">
              <MatchList
                eventCode={activeEvent.code}
                season={activeEvent.season}
                type="Practice"
                onSelect={(match) => choose({ type: "Practice", match })}
              />
            </TabsContent>
            <TabsContent value="Qualification">
              <MatchList
                eventCode={activeEvent.code}
                season={activeEvent.season}
                type="Qualification"
                onSelect={(match) => choose({ type: "Qualification", match })}
              />
            </TabsContent>
            <TabsContent value="Playoff">
              <BracketPicker
                eventCode={activeEvent.code}
                season={activeEvent.season}
                onSelect={(match) => choose({ type: "Playoff", match })}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoActiveEvent() {
  return (
    <div className="glass-card mt-4 flex flex-col items-center gap-3 p-8 text-center">
      <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
      <div>
        <div className="font-semibold">No active event selected</div>
        <p className="text-sm text-[var(--muted-foreground)]">Pick an event first so matches can load.</p>
      </div>
      <Link href="/event">
        <Button variant="glass" size="sm">
          Go to Active Event
        </Button>
      </Link>
    </div>
  );
}

function MatchList({
  eventCode,
  season,
  type,
  onSelect,
}: {
  eventCode: string;
  season: number;
  type: MatchType;
  onSelect: (match: FtcMatch) => void;
}) {
  const query = useFtcQuery(`matches:${eventCode}:${season}:${type}`, () => getMatchesForEvent(eventCode, type, season));

  if (query.status === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <GlassSkeletonCard className="h-14 p-3" />
        <GlassSkeletonCard className="h-14 p-3" />
        <GlassSkeletonCard className="h-14 p-3" />
      </div>
    );
  }
  if (query.status === "error") {
    return (
      <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
        Couldn&apos;t load matches &mdash; {query.error?.message}
      </div>
    );
  }
  if (query.status === "empty") {
    return (
      <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
        {type === "Practice"
          ? "Practice matches aren't tracked by the FIRST API."
          : `No ${type.toLowerCase()} matches yet — check back once the event starts.`}
      </div>
    );
  }

  return (
    <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
      {(query.data ?? []).map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onSelect(m)}
          className="glass-card flex flex-wrap items-center justify-between gap-2 p-3.5 text-left transition-colors hover:bg-white/8"
        >
          <div className="flex items-center gap-3">
            <span className="font-semibold">
              {MATCH_TYPE_PREFIX[type]}
              {m.matchNumber}
            </span>
            {m.startTime && (
              <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                <Clock className="h-3 w-3" />
                {new Date(m.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="text-xs">
            <span className="text-red-300">{m.redTeams.join(", ")}</span>
            <span className="mx-1.5 text-[var(--muted-foreground)]">vs</span>
            <span className="text-blue-300">{m.blueTeams.join(", ")}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

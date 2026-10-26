"use client";

import { useState } from "react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { SLOT_IDS, type ScheduleResult, type SlotId } from "@/lib/scheduler/types";
import type { TeamMember } from "@/lib/team-members";

const SLOT_LABELS: Record<SlotId, string> = { red1: "Red 1", red2: "Red 2", blue1: "Blue 1", blue2: "Blue 2" };

function nameFor(members: TeamMember[], uid: string | null): string {
  if (!uid) return "—";
  return members.find((m) => m.uid === uid)?.name ?? uid;
}

/**
 * Matches as rows, Red1/Red2/Blue1/Blue2 as columns, scout names in cells,
 * per-scout totals at the bottom. Editable (click a cell to swap) when
 * `onSwap` is given — omitted for the read-only view non-admins see and
 * for an unpublished draft (only takes `slots`/`counts`/`fair`/`warning`,
 * so it works for both a full `AssignmentVersion` and a bare
 * `ScheduleResult` before it's ever been wrapped into one).
 */
export function ScheduleGrid({
  version,
  members,
  onSwap,
}: {
  version: ScheduleResult;
  members: TeamMember[];
  onSwap?: (matchType: string, matchNumber: number, slot: SlotId, newScoutUid: string | null) => void;
}) {
  const [editing, setEditing] = useState<{ matchType: string; matchNumber: number; slot: SlotId } | null>(null);

  const matchKeys = [...new Map(version.slots.map((s) => [`${s.matchType}-${s.matchNumber}`, { matchType: s.matchType, matchNumber: s.matchNumber }])).values()];
  matchKeys.sort((a, b) => a.matchNumber - b.matchNumber || a.matchType.localeCompare(b.matchType));

  const cell = (matchType: string, matchNumber: number, slot: SlotId) =>
    version.slots.find((s) => s.matchType === matchType && s.matchNumber === matchNumber && s.slot === slot) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <THead>
          <TR>
            <TH>Match</TH>
            {SLOT_IDS.map((slot) => (
              <TH key={slot}>{SLOT_LABELS[slot]}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {matchKeys.map(({ matchType, matchNumber }) => (
            <TR key={`${matchType}-${matchNumber}`}>
              <TD className="font-mono text-sm">
                {MATCH_TYPE_PREFIX[matchType as keyof typeof MATCH_TYPE_PREFIX]}
                {matchNumber}
              </TD>
              {SLOT_IDS.map((slot) => {
                const slotData = cell(matchType, matchNumber, slot);
                const isEditing =
                  editing?.matchType === matchType && editing.matchNumber === matchNumber && editing.slot === slot;
                if (!slotData) return <TD key={slot}>—</TD>;
                if (isEditing && onSwap) {
                  return (
                    <TD key={slot}>
                      <Select
                        value={slotData.scoutUid ?? "none"}
                        onValueChange={(v) => {
                          onSwap(matchType, matchNumber, slot, v === "none" ? null : v);
                          setEditing(null);
                        }}
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue>{nameFor(members, slotData.scoutUid)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.uid} value={m.uid}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TD>
                  );
                }
                return (
                  <TD key={slot}>
                    <button
                      type="button"
                      disabled={!onSwap}
                      onClick={() => setEditing({ matchType, matchNumber, slot })}
                      className={onSwap ? "underline-offset-4 hover:underline" : undefined}
                    >
                      {nameFor(members, slotData.scoutUid)}
                    </button>
                    <span className="ml-1.5 text-[10px] text-[var(--muted-foreground)]">#{slotData.teamNumber}</span>
                  </TD>
                );
              })}
            </TR>
          ))}
        </TBody>
      </Table>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Totals</span>
        {Object.entries(version.counts).map(([uid, count]) => (
          <Badge key={uid} variant="glass" className="text-xs">
            {nameFor(members, uid)}: {count}
          </Badge>
        ))}
      </div>

      {!version.fair && version.warning && <p className="text-sm text-amber-400">{version.warning}</p>}
    </div>
  );
}

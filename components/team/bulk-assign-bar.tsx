"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldTeamFullLabel, type FieldTeam } from "@/lib/field-teams";
import { spring } from "@/lib/motion";

/**
 * P19: Team Management's bulk action. With members selected, pick an FTC team and add them to it or
 * take them off it. The page does the (single-batch, audited) write; this only collects the choice.
 */
export function BulkAssignBar({
  count,
  fieldTeams,
  busy,
  error,
  onApply,
  onClear,
}: {
  count: number;
  fieldTeams: FieldTeam[];
  busy: boolean;
  error: string | null;
  onApply: (teamId: string, mode: "add" | "remove") => void;
  onClear: () => void;
}) {
  const [teamId, setTeamId] = useState<string>(fieldTeams[0]?.id ?? "");
  // The chosen team may have been removed while the bar was open.
  const chosen = fieldTeams.find((t) => t.id === teamId) ?? fieldTeams[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={spring}
      // glass-overlay: solid backing — this bar floats over the roster as it scrolls.
      className="glass-overlay sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl p-4 shadow-2xl sm:flex-row sm:items-center"
      role="region"
      aria-label="Assign selected members to an FTC team"
    >
      <div className="text-sm font-semibold tabular-nums" aria-live="polite">
        {count} selected
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <Select value={chosen?.id ?? ""} onValueChange={setTeamId} disabled={busy}>
          <SelectTrigger className="w-full sm:w-60" aria-label="FTC team to assign">
            <SelectValue>{chosen ? fieldTeamFullLabel(chosen) : "Choose a team"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {fieldTeams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {fieldTeamFullLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-11" disabled={busy || !chosen} onClick={() => chosen && onApply(chosen.id, "add")}>
          Add to team
        </Button>
        <Button size="sm" variant="glass" className="h-11" disabled={busy || !chosen} onClick={() => chosen && onApply(chosen.id, "remove")}>
          Remove from team
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-red-300">
          {error}
        </p>
      )}
      <Button size="sm" variant="ghost" className="h-11" onClick={onClear} disabled={busy}>
        Clear
      </Button>
    </motion.div>
  );
}

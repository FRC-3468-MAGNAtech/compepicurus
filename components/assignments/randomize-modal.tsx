"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MemberMultiSelect } from "@/components/assignments/member-multiselect";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { MatchType } from "@/lib/ftc/types";
import type { TeamMember } from "@/lib/team-members";
import { filterMatchesByCategories, filterMatchesByRanges, parseMatchRanges } from "@/lib/scheduler/ranges";
import { generateSchedule } from "@/lib/scheduler/scheduler";
import { randomSeed } from "@/lib/scheduler/rng";
import type { MatchInput, RotationPattern, ScheduleResult } from "@/lib/scheduler/types";
import type { AssignmentMatchSource, AssignmentSettings } from "@/lib/assignments";
import type { Difficulty } from "@/lib/difficulty";

const PATTERN_LABELS: Record<RotationPattern, string> = {
  "rotate-each-match": "Rotate Each Match",
  "custom-interval": "Custom Interval",
  "constant-same-order": "Constant Same Order",
};

const CATEGORIES: MatchType[] = ["Practice", "Qualification", "Playoff"];

export function RandomizeModal({
  open,
  onOpenChange,
  matchSource,
  seasonId,
  difficulty,
  matches,
  attendingMembers,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matchSource: AssignmentMatchSource;
  seasonId: string | null;
  difficulty: Difficulty | null;
  /** Every candidate match for the currently-selected match source (event/practice-library/live) — already resolved by the parent. */
  matches: MatchInput[];
  attendingMembers: TeamMember[];
  onGenerated: (settings: AssignmentSettings, result: ScheduleResult, matches: MatchInput[]) => void;
}) {
  const [rangesText, setRangesText] = useState("");
  const [categories, setCategories] = useState<MatchType[]>(["Qualification"]);
  const [pattern, setPattern] = useState<RotationPattern>("rotate-each-match");
  const [intervalSize, setIntervalSize] = useState(4);
  const [scoutUids, setScoutUids] = useState<string[]>(attendingMembers.map((m) => m.uid));
  const [prioritizedText, setPrioritizedText] = useState("");

  const rangesActive = rangesText.trim().length > 0;

  const { ranges, errors: rangeErrors } = useMemo(() => parseMatchRanges(rangesText), [rangesText]);
  const prioritizedTeams = useMemo(
    () => prioritizedText.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
    [prioritizedText]
  );

  const { selectedMatches, rangeWarnings } = useMemo(() => {
    if (rangesActive) {
      const { matches: filtered, warnings } = filterMatchesByRanges(matches, ranges);
      return { selectedMatches: filtered, rangeWarnings: warnings };
    }
    return { selectedMatches: filterMatchesByCategories(matches, categories), rangeWarnings: [] };
  }, [matches, rangesActive, ranges, categories]);

  const toggleCategory = (c: MatchType) => setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const handleGenerate = () => {
    const settings: AssignmentSettings = {
      matchSource,
      seasonId,
      difficulty,
      rangesText,
      categories,
      pattern,
      intervalSize: pattern === "custom-interval" ? intervalSize : null,
      scoutUids,
      prioritizedTeams,
      seed: randomSeed(),
    };
    const result = generateSchedule(selectedMatches, {
      scoutUids,
      pattern,
      intervalSize: pattern === "custom-interval" ? intervalSize : undefined,
      prioritizedTeams: prioritizedTeams.length > 0 ? prioritizedTeams : undefined,
      seed: settings.seed,
    });
    onGenerated(settings, result, selectedMatches);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(95vw,640px)] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Randomize schedule</DialogTitle>
        <DialogDescription>Pick which matches to schedule and how scouts rotate through them.</DialogDescription>

        <div className="mt-4 flex flex-col gap-5">
          <div>
            <Label htmlFor="ranges">Ranges</Label>
            <Input
              id="ranges"
              value={rangesText}
              onChange={(e) => setRangesText(e.target.value)}
              placeholder="P12-14, Q17-18, F2-3"
            />
            {rangeErrors.map((e, i) => (
              <p key={i} className="mt-1 text-xs text-red-400">{e}</p>
            ))}
            {rangeWarnings.map((w, i) => (
              <p key={i} className="mt-1 text-xs text-amber-400">{w}</p>
            ))}
          </div>

          <div>
            <Label>Categories</Label>
            <div className={`flex gap-3 ${rangesActive ? "opacity-50" : ""}`}>
              {CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={categories.includes(c)} onCheckedChange={() => toggleCategory(c)} disabled={rangesActive} />
                  {MATCH_TYPE_PREFIX[c]} &middot; {c}
                </label>
              ))}
            </div>
            {rangesActive && <p className="mt-1 text-xs text-[var(--muted-foreground)]">Disabled while a range is entered.</p>}
          </div>

          <p className="text-xs text-[var(--muted-foreground)]">{selectedMatches.length} match(es) selected.</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pattern">Rotation pattern</Label>
              <Select value={pattern} onValueChange={(v) => setPattern(v as RotationPattern)}>
                <SelectTrigger id="pattern">
                  <SelectValue>{PATTERN_LABELS[pattern]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PATTERN_LABELS) as RotationPattern[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PATTERN_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pattern === "custom-interval" && (
              <div>
                <Label htmlFor="interval">Matches per swap</Label>
                <Input
                  id="interval"
                  type="number"
                  min={1}
                  value={intervalSize}
                  onChange={(e) => setIntervalSize(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            )}
          </div>

          <div>
            <Label>Scouts</Label>
            <MemberMultiSelect members={attendingMembers} selected={scoutUids} onChange={setScoutUids} />
          </div>

          <div>
            <Label htmlFor="prioritized">Prioritize teams (optional)</Label>
            <Input
              id="prioritized"
              value={prioritizedText}
              onChange={(e) => setPrioritizedText(e.target.value)}
              placeholder="3468, 1234"
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              With few scouts, only these teams&apos; robots get assigned — every other slot is left open so breaks stay fair.
            </p>
          </div>

          <Button size="lg" disabled={scoutUids.length === 0 || selectedMatches.length === 0} onClick={handleGenerate}>
            Generate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

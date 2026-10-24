"use client";

import { Radio, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS, type Difficulty } from "@/lib/difficulty";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export function DifficultySelect({ onSelect }: { onSelect: (difficulty: Difficulty) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">Choose a difficulty</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {DIFFICULTIES.map((difficulty) => (
          <GlassPanel
            key={difficulty}
            interactive
            onClick={() => onSelect(difficulty)}
            className="flex flex-col items-center gap-2 py-10 text-center"
          >
            <Badge className={`text-sm ${DIFFICULTY_CLASSNAMES[difficulty]}`}>{DIFFICULTY_LABELS[difficulty]}</Badge>
          </GlassPanel>
        ))}
      </div>

      <h3 className="mt-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Other ways to scout</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GlassPanel className="flex flex-col items-center gap-2 py-8 text-center opacity-60">
          <Radio className="h-6 w-6 text-[var(--muted-foreground)]" />
          <div className="text-base font-semibold">Live</div>
          <Badge variant="outline" className="text-[10px]">
            Coming soon
          </Badge>
        </GlassPanel>
        <GlassPanel className="flex flex-col items-center gap-2 py-8 text-center opacity-60">
          <Users className="h-6 w-6 text-[var(--muted-foreground)]" />
          <div className="text-base font-semibold">Live Practice Lobby</div>
          <Badge variant="outline" className="text-[10px]">
            Coming soon
          </Badge>
        </GlassPanel>
      </div>
    </div>
  );
}

"use client";

import { Radio, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS, type Difficulty } from "@/lib/difficulty";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export function DifficultySelect({
  onSelect,
  onSelectLive,
  onSelectLobby,
}: {
  onSelect: (difficulty: Difficulty) => void;
  onSelectLive: () => void;
  onSelectLobby: () => void;
}) {
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
        <GlassPanel interactive onClick={onSelectLive} className="flex flex-col items-center gap-2 py-8 text-center">
          <Radio className="h-6 w-6 text-[var(--color-primary)]" />
          <div className="text-base font-semibold">Live</div>
          <p className="text-xs text-[var(--muted-foreground)]">Scout a real, livestreamed FTC match.</p>
        </GlassPanel>
        <GlassPanel interactive onClick={onSelectLobby} className="flex flex-col items-center gap-2 py-8 text-center">
          <Users className="h-6 w-6 text-[var(--color-primary)]" />
          <div className="text-base font-semibold">Live Practice Lobby</div>
          <p className="text-xs text-[var(--muted-foreground)]">Host or join a Kahoot-style group scouting round.</p>
        </GlassPanel>
      </div>
    </div>
  );
}

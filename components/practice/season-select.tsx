"use client";

import { GlassPanel } from "@/components/ui/glass-panel";
import { getEnabledSeasons } from "@/lib/seasons";

export function SeasonSelect({ onSelect }: { onSelect: (seasonId: string) => void }) {
  const seasons = getEnabledSeasons();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">Choose a season</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {seasons.map((season) => (
          <GlassPanel
            key={season.id}
            interactive
            onClick={() => onSelect(season.id)}
            className="flex flex-col items-center gap-2 py-10 text-center"
          >
            <span className="text-2xl font-bold">{season.name}</span>
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}

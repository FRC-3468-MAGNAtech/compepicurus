"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ScoutCategory } from "@/lib/scout-stats/types";

const CATEGORY_LABELS: Record<ScoutCategory, string> = {
  trial: "Trial Mode",
  competitive: "Competitive Mode",
  "real-event": "Real Event",
};

export function CategoryTabs({ value, onChange }: { value: ScoutCategory; onChange: (category: ScoutCategory) => void }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as ScoutCategory)}>
      <TabsList>
        {(Object.keys(CATEGORY_LABELS) as ScoutCategory[]).map((category) => (
          <TabsTrigger key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

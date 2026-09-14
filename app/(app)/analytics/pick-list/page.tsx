"use client";

import { Reorder } from "framer-motion";
import { useState } from "react";
import { GripVertical } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { pickList as initialPickList } from "@/lib/mock-data";
import { spring } from "@/lib/motion";

export default function PickListPage() {
  const [list, setList] = useState(initialPickList);

  return (
    <GlassPanel>
      <div className="mb-4">
        <h2 className="text-base font-semibold">Pick list</h2>
        <p className="text-sm text-[var(--muted-foreground)]">Drag to reorder your alliance selection priority.</p>
      </div>
      <Reorder.Group axis="y" values={list} onReorder={setList} className="flex flex-col gap-2.5">
        {list.map((entry, i) => (
          <Reorder.Item
            key={entry.teamNumber}
            value={entry}
            className="glass-card flex cursor-grab items-center gap-4 p-4 active:cursor-grabbing"
            whileDrag={{ scale: 1.02, boxShadow: "0 12px 32px -8px rgba(0,0,0,0.5)" }}
            transition={spring}
          >
            <GripVertical className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <Badge variant="accent">{i + 1}</Badge>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {entry.teamNumber} &mdash; {entry.teamName}
              </div>
              <div className="truncate text-xs text-[var(--muted-foreground)]">{entry.notes}</div>
            </div>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </GlassPanel>
  );
}

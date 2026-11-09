"use client";

import { TriangleAlert } from "lucide-react";
import { HoverTip } from "@/components/ui/hover-tip";

/** P27: the caution icon beside an answer that differs from the plan; its tooltip says what was planned ("Planned: Hive"). Works on hover, focus and tap. */
export function PlanDiffIcon({ text }: { text: string }) {
  return (
    <HoverTip content={text} align="start" className="ml-1.5 align-middle">
      <span className="inline-flex items-center text-amber-300" data-testid="plan-diff" aria-label={`Differs from the plan. ${text}`}>
        <TriangleAlert className="h-4 w-4" aria-hidden />
      </span>
    </HoverTip>
  );
}

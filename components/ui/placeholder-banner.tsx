import { Construction } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlaceholderBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 self-start rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-medium text-amber-300",
        className
      )}
    >
      <Construction className="h-4 w-4 shrink-0" />
      <span>Placeholder page &mdash; showing sample data, not yet connected to a real backend.</span>
    </div>
  );
}

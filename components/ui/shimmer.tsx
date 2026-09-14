import { cn } from "@/lib/utils";

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-2xl", className)} />;
}

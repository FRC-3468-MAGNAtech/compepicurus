import { Shimmer } from "@/components/ui/shimmer";
import { cn } from "@/lib/utils";

export function GlassSkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("glass-card flex flex-col gap-3 p-6", className)}>
      <Shimmer className="h-4 w-2/3" />
      <Shimmer className="h-3 w-1/3" />
      <Shimmer className="h-3 w-1/2" />
    </div>
  );
}

export function GlassSkeletonGrid({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <GlassSkeletonCard key={i} />
      ))}
    </div>
  );
}

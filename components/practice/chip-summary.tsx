import type { Difficulty } from "@/lib/difficulty";
import { DIFFICULTY_LABELS } from "@/lib/difficulty";
import type { SessionMode } from "@/lib/practice-sessions";

const MODE_LABELS: Record<Exclude<SessionMode, null>, string> = { trial: "Trial", competitive: "Competitive" };

/** The `BIOBUZZ · Trial · Medium`-style breadcrumb shown across every step once it's known. */
export function ChipSummary({
  seasonName,
  mode,
  difficulty,
  className,
}: {
  seasonName?: string | null;
  mode?: SessionMode;
  difficulty?: Difficulty | null;
  className?: string;
}) {
  const parts = [seasonName, mode ? MODE_LABELS[mode] : null, difficulty ? DIFFICULTY_LABELS[difficulty] : null].filter(
    (p): p is string => Boolean(p)
  );
  if (parts.length === 0) return null;

  return (
    <div className={`glass-pill inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium ${className ?? ""}`}>
      {parts.map((part, i) => (
        <span key={part} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--muted-foreground)]">·</span>}
          <span className={i === parts.length - 1 ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{part}</span>
        </span>
      ))}
    </div>
  );
}

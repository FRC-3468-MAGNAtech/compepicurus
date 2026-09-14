import { GitCommitVertical } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { changelog } from "@/lib/mock-data";

const tagVariant = {
  feature: "accent",
  fix: "warning",
  improvement: "success",
} as const;

export default function ChangelogPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Changelog</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Version history and release notes.</p>
      </div>

      <div className="relative flex flex-col gap-5 pl-6">
        <div className="absolute bottom-2 left-[9px] top-2 w-px bg-[var(--glass-border)]" aria-hidden />
        {changelog.map((entry) => (
          <div key={entry.version} className="relative">
            <span
              className="absolute -left-6 top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full"
              style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
            >
              <GitCommitVertical className="h-3 w-3 text-white" />
            </span>
            <GlassPanel className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">v{entry.version}</span>
                <Badge variant={tagVariant[entry.tag]}>{entry.tag}</Badge>
                <span className="text-xs text-[var(--muted-foreground)]">{entry.date}</span>
              </div>
              <h2 className="text-base font-semibold">{entry.title}</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
                {entry.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </GlassPanel>
          </div>
        ))}
      </div>
    </div>
  );
}

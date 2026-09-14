import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { scouts } from "@/lib/mock-data";

const statuses = ["Scouting now", "Scouting now", "On break", "Scouting now", "Off shift", "Off shift"];

export default function ScoutStatusPage() {
  return (
    <GlassPanel>
      <h2 className="mb-4 text-base font-semibold">Scout status board</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scouts.map((s, i) => {
          const status = statuses[i % statuses.length];
          const live = status === "Scouting now";
          return (
            <div key={s.id} className="glass-card flex items-center gap-3 p-4">
              <div className="relative">
                <Avatar name={s.name} color={s.avatarColor} />
                {live && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--background)] bg-emerald-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="truncate text-xs text-[var(--muted-foreground)]">{s.role}</div>
              </div>
              <Badge variant={live ? "success" : "outline"}>{status}</Badge>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}

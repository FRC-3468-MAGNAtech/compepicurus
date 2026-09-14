import { Bot, Heart, Trophy } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const teamCredits = [
  { name: "Priya Nandakumar", role: "Lead Scout & Product Direction" },
  { name: "Marcus Webb", role: "Software Lead" },
  { name: "Ana Torres", role: "Scouting Lead" },
  { name: "Devon Ellis", role: "Drive Coach" },
  { name: "Kai Fujimoto", role: "CAD & Design" },
  { name: "Lena Brandt", role: "Mentor" },
];

export default function CreditsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="text-center">
        <Trophy className="mx-auto h-9 w-9" style={{ color: "var(--color-secondary)" }} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Credits</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          CompEpicurus is built and maintained by FTC Team 3468 &mdash; MAGNAtech.
        </p>
      </div>

      <GlassPanel strong className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
          <Bot className="h-6 w-6" />
        </span>
        <div>
          <div className="font-semibold">Claude (Anthropic)</div>
          <p className="text-sm text-[var(--muted-foreground)]">
            AI collaborator on this build &mdash; scaffolded the app, design system, and every page in this shell
            alongside the team.
          </p>
        </div>
      </GlassPanel>

      <GlassPanel>
        <div className="mb-4 flex items-center gap-2">
          <Heart className="h-4 w-4" style={{ color: "var(--color-primary)" }} />
          <h2 className="text-base font-semibold">Team MAGNAtech</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {teamCredits.map((c) => (
            <div key={c.name} className="flex items-center gap-3">
              <Avatar name={c.name} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="truncate text-xs text-[var(--muted-foreground)]">{c.role}</div>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>

      <div className="flex justify-center">
        <Badge variant="glass">Made with bounce &amp; glass &mdash; FTC 3468</Badge>
      </div>
    </div>
  );
}

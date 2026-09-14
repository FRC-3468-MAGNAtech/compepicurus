import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat-card";
import { scouts } from "@/lib/mock-data";

export default function ScoutAccuracyPage() {
  const avg = scouts.reduce((s, sc) => s + sc.accuracy, 0) / scouts.length;
  const mostConsistent = [...scouts].sort((a, b) => b.accuracy - a.accuracy)[0];
  const mostActive = [...scouts].sort((a, b) => b.matchesScouted - a.matchesScouted)[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scout Accuracy</h1>
        <p className="text-sm text-[var(--muted-foreground)]">How consistent each scout&apos;s data has been.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Average accuracy" value={`${avg.toFixed(1)}%`} index={0} />
        <StatCard label="Most consistent" value={mostConsistent.name} delta={`${mostConsistent.accuracy}%`} index={1} />
        <StatCard label="Most active" value={mostActive.name} delta={`${mostActive.matchesScouted} matches`} index={2} />
      </div>

      <GlassPanel>
        <h2 className="mb-4 text-base font-semibold">Per-scout breakdown</h2>
        <Table>
          <THead>
            <TR>
              <TH>Scout</TH>
              <TH>Role</TH>
              <TH>Matches scouted</TH>
              <TH>Accuracy</TH>
            </TR>
          </THead>
          <TBody>
            {scouts.map((s) => (
              <TR key={s.id}>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={s.name} color={s.avatarColor} size="sm" />
                    <span className="font-medium">{s.name}</span>
                  </div>
                </TD>
                <TD className="text-[var(--muted-foreground)]">{s.role}</TD>
                <TD>{s.matchesScouted}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${s.accuracy}%`,
                          background: "linear-gradient(90deg, var(--color-primary), var(--color-accent))",
                        }}
                      />
                    </div>
                    <Badge variant={s.accuracy > 93 ? "success" : "outline"}>{s.accuracy}%</Badge>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </GlassPanel>
    </div>
  );
}

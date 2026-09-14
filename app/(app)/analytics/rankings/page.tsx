import { Trophy } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { teamStats } from "@/lib/mock-data";

export default function RankingsPage() {
  const ranked = [...teamStats].sort((a, b) => a.rank - b.rank);

  return (
    <GlassPanel>
      <h2 className="mb-4 text-base font-semibold">Event rankings</h2>
      <Table>
        <THead>
          <TR>
            <TH>Rank</TH>
            <TH>Team</TH>
            <TH>Win rate</TH>
            <TH>Avg. total</TH>
          </TR>
        </THead>
        <TBody>
          {ranked.map((t) => (
            <TR key={t.teamNumber}>
              <TD>
                <div className="flex items-center gap-2">
                  {t.rank <= 3 && <Trophy className="h-4 w-4" style={{ color: "var(--color-secondary)" }} />}
                  <span className="font-semibold">{t.rank}</span>
                </div>
              </TD>
              <TD>
                <div className="font-medium">{t.teamNumber}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{t.teamName}</div>
              </TD>
              <TD>
                <Badge variant={t.winRate > 0.7 ? "success" : "outline"}>{Math.round(t.winRate * 100)}%</Badge>
              </TD>
              <TD className="font-semibold">{t.avgTotal.toFixed(1)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </GlassPanel>
  );
}

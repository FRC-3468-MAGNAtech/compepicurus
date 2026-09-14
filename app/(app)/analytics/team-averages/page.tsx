import { GlassPanel } from "@/components/ui/glass-panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { teamStats } from "@/lib/mock-data";

export default function TeamAveragesPage() {
  const sorted = [...teamStats].sort((a, b) => b.avgTotal - a.avgTotal);

  return (
    <GlassPanel>
      <h2 className="mb-4 text-base font-semibold">Team scoring averages</h2>
      <Table>
        <THead>
          <TR>
            <TH>Team</TH>
            <TH>Avg. Auto</TH>
            <TH>Avg. Teleop</TH>
            <TH>Avg. Endgame</TH>
            <TH>Avg. Total</TH>
          </TR>
        </THead>
        <TBody>
          {sorted.map((t) => (
            <TR key={t.teamNumber}>
              <TD>
                <div className="font-medium">{t.teamNumber}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{t.teamName}</div>
              </TD>
              <TD>{t.avgAuto.toFixed(1)}</TD>
              <TD>{t.avgTeleop.toFixed(1)}</TD>
              <TD>{t.avgEndgame.toFixed(1)}</TD>
              <TD className="font-semibold">{t.avgTotal.toFixed(1)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </GlassPanel>
  );
}

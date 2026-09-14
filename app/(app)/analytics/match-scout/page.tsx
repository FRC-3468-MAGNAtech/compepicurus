import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { matches } from "@/lib/mock-data";

export default function MatchScoutAnalyticsPage() {
  return (
    <GlassPanel>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Match-by-match scouting log</h2>
        <Badge variant="glass">{matches.length} matches</Badge>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Match</TH>
            <TH>Red alliance</TH>
            <TH>Blue alliance</TH>
            <TH>Score</TH>
            <TH>Scout</TH>
            <TH>Time</TH>
          </TR>
        </THead>
        <TBody>
          {matches.map((m) => (
            <TR key={m.id}>
              <TD className="font-medium">Q{m.matchNumber}</TD>
              <TD className="text-red-300">{m.redAlliance.join(", ")}</TD>
              <TD className="text-blue-300">{m.blueAlliance.join(", ")}</TD>
              <TD className="font-semibold">
                {m.redScore}&ndash;{m.blueScore}
              </TD>
              <TD>{m.scout}</TD>
              <TD className="text-[var(--muted-foreground)]">{m.time}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </GlassPanel>
  );
}

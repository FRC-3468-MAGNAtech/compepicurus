"use client";

import { useMemo, useState } from "react";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useAuditLog } from "@/lib/audit-log";
import { exportAllDataJson, exportEntriesCsv, type BackupSummary } from "@/lib/admin/backup";

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/** A safety net for competition day — plain client-side reads + downloads, no restore side. "Last export" is derived from the audit log rather than a new field anywhere. */
export function BackupsPanel() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { entries: auditEntries } = useAuditLog(teamId);

  const [exportingJson, setExportingJson] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastExport = useMemo(() => {
    const exports = auditEntries.filter((e) => e.action === "export-backup");
    if (exports.length === 0) return null;
    return exports.reduce((latest, e) => (toMillis(e.createdAt) > toMillis(latest.createdAt) ? e : latest));
  }, [auditEntries]);

  const handleExportJson = async () => {
    if (!teamId || !user || !profile) return;
    setExportingJson(true);
    setError(null);
    try {
      setSummary(await exportAllDataJson(teamId, user.uid, profile.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export data.");
    } finally {
      setExportingJson(false);
    }
  };

  const handleExportCsv = async () => {
    if (!teamId || !user || !profile) return;
    setExportingCsv(true);
    setError(null);
    try {
      await exportEntriesCsv(teamId, user.uid, profile.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export entries.");
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold">Download all data</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            One JSON file with every in-scope collection for this team (users, scout entries, practice sessions, assignments, attendance,
            audit log, the shared match library, and your team doc) — a safety net for competition day, not a restore tool.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button className="gap-2" disabled={exportingJson} onClick={handleExportJson}>
            <FileJson className="h-4 w-4" /> {exportingJson ? "Exporting…" : "Download All Data (JSON)"}
          </Button>
          <Button variant="glass" className="gap-2" disabled={exportingCsv} onClick={handleExportCsv}>
            <FileSpreadsheet className="h-4 w-4" /> {exportingCsv ? "Exporting…" : "Download Entries (CSV)"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="text-xs text-[var(--muted-foreground)]">
          Last export: {lastExport ? `${new Date(toMillis(lastExport.createdAt)).toLocaleString()} by ${lastExport.actorName}` : "never"}
        </p>
        {summary && (
          <div className="flex flex-wrap gap-2">
            {summary.map((s) => (
              <span key={s.collection} className="glass-card flex items-center gap-1.5 px-2.5 py-1 text-xs">
                <Download className="h-3 w-3 text-[var(--muted-foreground)]" /> {s.collection}: {s.count}
              </span>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

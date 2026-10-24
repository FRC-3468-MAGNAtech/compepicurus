"use client";

import { useRef, useState } from "react";
import { Download, RefreshCw, Upload, VideoOff } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useTeamDoc, setUsePlaceholderVideo } from "@/lib/team";
import { getEnabledSeasons, DEFAULT_SEASON_ID } from "@/lib/seasons";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS } from "@/lib/difficulty";
import {
  importLibraryEvent,
  importVideoCsv,
  setLibraryMatchVideo,
  useLibraryMatches,
  type LibraryMatch,
  type LibraryVideo,
} from "@/lib/match-library";

const SEASONS = getEnabledSeasons();

export function MatchLibraryPanel() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team } = useTeamDoc(teamId);
  const [seasonId, setSeasonId] = useState(DEFAULT_SEASON_ID);
  const [eventCodeInput, setEventCodeInput] = useState("");
  const [viewingEventCode, setViewingEventCode] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const { matches, loaded } = useLibraryMatches(viewingEventCode);
  const missingVideoCount = matches.filter((m) => !m.video).length;

  const handleImport = async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setImporting(true);
    setImportError(null);
    setImportMessage(null);
    try {
      const result = await importLibraryEvent(seasonId, trimmed);
      setViewingEventCode(trimmed);
      setImportMessage(`${result.eventName}: imported ${result.imported} match${result.imported === 1 ? "" : "es"}, skipped ${result.skipped} without posted scores.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Couldn't import that event.");
    } finally {
      setImporting(false);
    }
  };

  const handleCsvFile = async (file: File) => {
    const text = await file.text();
    setCsvMessage(null);
    const result = await importVideoCsv(text);
    setCsvMessage(
      `Updated ${result.updated} match${result.updated === 1 ? "" : "es"}.` + (result.errors.length > 0 ? ` ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} skipped.` : "")
    );
  };

  return (
    <GlassPanel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Match Library</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Import real events for practice scouting (P4+). No videos are added here automatically.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-[var(--muted-foreground)]">Use placeholder video for testing</span>
          <Switch
            checked={team?.usePlaceholderVideo ?? false}
            onCheckedChange={(v) => teamId && void setUsePlaceholderVideo(teamId, v)}
            disabled={!teamId}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="library-season">Season</Label>
          <Select value={seasonId} onValueChange={setSeasonId}>
            <SelectTrigger id="library-season" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEASONS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <Label htmlFor="library-event-code">Event code</Label>
          <Input
            id="library-event-code"
            value={eventCodeInput}
            onChange={(e) => setEventCodeInput(e.target.value.toUpperCase())}
            placeholder="USWABON1"
          />
        </div>
        <Button className="gap-2" disabled={importing || !eventCodeInput.trim()} onClick={() => handleImport(eventCodeInput)}>
          <Download className="h-4 w-4" /> {importing ? "Importing…" : "Import event"}
        </Button>
        {viewingEventCode && (
          <Button variant="glass" className="gap-2" disabled={importing} onClick={() => handleImport(viewingEventCode)}>
            <RefreshCw className={importing ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh scores
          </Button>
        )}
      </div>

      {importError && <p className="text-sm text-red-400">{importError}</p>}
      {importMessage && <p className="text-sm text-emerald-400">{importMessage}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--glass-border)] pt-4">
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0])}
        />
        <Button variant="glass" size="sm" className="gap-2" onClick={() => csvInputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Bulk import video CSV
        </Button>
        <span className="text-xs text-[var(--muted-foreground)]">Columns: matchKey, url, startSec, endSec</span>
        {csvMessage && <span className="text-xs text-emerald-400">{csvMessage}</span>}
      </div>

      {viewingEventCode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{viewingEventCode}</h3>
            {missingVideoCount > 0 && <Badge variant="warning">{missingVideoCount} missing video</Badge>}
          </div>
          {!loaded ? (
            <div className="glass-card h-24 animate-pulse" />
          ) : matches.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No matches imported for this event yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Match</TH>
                  <TH>Red</TH>
                  <TH>Blue</TH>
                  <TH>Video</TH>
                  <TH>Start</TH>
                  <TH>End</TH>
                  <TH>&nbsp;</TH>
                </TR>
              </THead>
              <TBody>
                {matches.map((m) => (
                  <LibraryMatchRow key={m.id} match={m} />
                ))}
              </TBody>
            </Table>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

function LibraryMatchRow({ match }: { match: LibraryMatch }) {
  const [url, setUrl] = useState(match.video?.youtubeUrl ?? "");
  const [startSec, setStartSec] = useState(String(match.video?.startSec ?? ""));
  const [endSec, setEndSec] = useState(String(match.video?.endSec ?? ""));
  const [saving, setSaving] = useState(false);

  const dirty =
    url !== (match.video?.youtubeUrl ?? "") ||
    startSec !== String(match.video?.startSec ?? "") ||
    endSec !== String(match.video?.endSec ?? "");

  const handleSave = async () => {
    setSaving(true);
    try {
      const start = Number(startSec);
      const end = Number(endSec);
      const video: LibraryVideo | null = url.trim() && Number.isFinite(start) && Number.isFinite(end) ? { youtubeUrl: url.trim(), startSec: start, endSec: end } : null;
      await setLibraryMatchVideo(match.id, video);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TR>
      <TD className="font-medium">
        {MATCH_TYPE_PREFIX[match.matchType]}
        {match.matchNumber}
      </TD>
      <TD>
        <div className="flex items-center gap-1.5 text-red-300">
          {match.alliances.red.score}
          <Badge className={DIFFICULTY_CLASSNAMES[match.alliances.red.difficulty]}>{DIFFICULTY_LABELS[match.alliances.red.difficulty]}</Badge>
        </div>
      </TD>
      <TD>
        <div className="flex items-center gap-1.5 text-blue-300">
          {match.alliances.blue.score}
          <Badge className={DIFFICULTY_CLASSNAMES[match.alliances.blue.difficulty]}>{DIFFICULTY_LABELS[match.alliances.blue.difficulty]}</Badge>
        </div>
      </TD>
      <TD className="min-w-[200px]">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="h-8 text-xs" />
      </TD>
      <TD className="w-20">
        <Input value={startSec} onChange={(e) => setStartSec(e.target.value)} placeholder="0" inputMode="numeric" className="h-8 text-xs" />
      </TD>
      <TD className="w-20">
        <Input value={endSec} onChange={(e) => setEndSec(e.target.value)} placeholder="150" inputMode="numeric" className="h-8 text-xs" />
      </TD>
      <TD>
        {!match.video && !dirty ? (
          <span title="Missing video">
            <VideoOff className="h-4 w-4 text-amber-400" />
          </span>
        ) : (
          <Button size="sm" variant="glass" disabled={!dirty || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </TD>
    </TR>
  );
}

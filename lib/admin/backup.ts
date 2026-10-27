"use client";

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { downloadTextFile } from "@/lib/download";
import { logAuditEvent } from "@/lib/audit-log";
import { entriesToCsv } from "@/lib/analytics/csv";
import { BIOBUZZ_SCHEMA } from "@/lib/analytics/game-schema";
import type { ScoutEntry } from "@/lib/scout-entries";

/**
 * Exactly the prompt's own list — users, scoutEntries, practiceSessions,
 * assignments, attendance (`eventAttendance`), auditLog — each scoped to
 * this team. `teams` (just this team's own doc) and `libraryMatches`
 * (shared, not teamId-scoped) are handled separately below. Collections
 * added after this prompt was written (liveMatches, notifications,
 * lobbies) are deliberately left out — see docs/ASSUMPTIONS.md (P9).
 */
const TEAM_SCOPED_COLLECTIONS = ["users", "scoutEntries", "practiceSessions", "assignments", "eventAttendance", "auditLog"] as const;

export type BackupSummary = { collection: string; count: number }[];

/** Reads every in-scope collection for `teamId` and triggers a single JSON download — a competition-day safety net, not a restore tool (there's no import side). */
export async function exportAllDataJson(teamId: string, actorUid: string, actorName: string): Promise<BackupSummary> {
  const collections: Record<string, unknown[]> = {};
  const summary: BackupSummary = [];

  for (const name of TEAM_SCOPED_COLLECTIONS) {
    const snap = await getDocs(query(collection(db, name), where("teamId", "==", teamId)));
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    collections[name] = docs;
    summary.push({ collection: name, count: docs.length });
  }

  const libSnap = await getDocs(collection(db, "libraryMatches"));
  collections.libraryMatches = libSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  summary.push({ collection: "libraryMatches", count: collections.libraryMatches.length });

  const teamSnap = await getDoc(doc(db, "teams", teamId));
  collections.teams = teamSnap.exists() ? [{ id: teamSnap.id, ...teamSnap.data() }] : [];
  summary.push({ collection: "teams", count: collections.teams.length });

  const payload = { exportedAt: new Date().toISOString(), teamId, collections };
  downloadTextFile(`compepicurus-backup-${teamId}-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
  await logAuditEvent(teamId, actorUid, actorName, "export-backup", { format: "json", summary }, null, null);
  return summary;
}

/** Every scoutEntries doc for the team (any source), as one CSV — the BIOBUZZ schema's columns, names never anonymized (this is an admin-only export). */
export async function exportEntriesCsv(teamId: string, actorUid: string, actorName: string): Promise<number> {
  const snap = await getDocs(query(collection(db, "scoutEntries"), where("teamId", "==", teamId)));
  const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ScoutEntry[];
  const csv = entriesToCsv(BIOBUZZ_SCHEMA, entries, (name) => name);
  downloadTextFile(`compepicurus-entries-${teamId}-${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
  await logAuditEvent(teamId, actorUid, actorName, "export-backup", { format: "csv", count: entries.length }, null, null);
  return entries.length;
}

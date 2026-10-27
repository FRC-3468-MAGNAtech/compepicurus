import { getMatchesForEvent } from "@/lib/ftc/actions";
import type { FtcMatch, MatchType } from "@/lib/ftc/types";
import { formatMatch } from "@/lib/analytics/game-schema";
import { getEventEntries, notApplicableAccuracy, updateEntry, type AccuracyResult, type AutoFlag } from "@/lib/scout-entries";
import { allianceForTeam, computeAllianceAccuracy } from "@/lib/analytics/accuracy";
import { evaluateAutoFlagRuleIds, type FlagContext } from "@/lib/analytics/flags";

function matchKey(type: MatchType, number: number) {
  return `${type}-${number}`;
}

async function buildMatchLookup(eventCode: string, season: number): Promise<Map<string, FtcMatch>> {
  const lookup = new Map<string, FtcMatch>();
  const [qual, playoff] = await Promise.all([
    getMatchesForEvent(eventCode, "Qualification", season),
    getMatchesForEvent(eventCode, "Playoff", season),
  ]);
  for (const res of [qual, playoff]) {
    if (res.ok) {
      for (const m of res.data) lookup.set(matchKey(m.type, m.matchNumber), m);
    }
  }
  return lookup;
}

export type EventRescorePatch = {
  entryId: string;
  matchLabel: string;
  teamNumber: number;
  before: AccuracyResult;
  after: AccuracyResult;
  autoFlags: AutoFlag[];
};

/** True when applying a patch would actually change anything a reader would notice. */
export function eventRescorePatchChanges(patch: EventRescorePatch): boolean {
  return patch.before.value !== patch.after.value || patch.before.status !== patch.after.status;
}

/**
 * Computes (without writing) what `recomputeForEvent` would write for every
 * entry in an event — the shared core behind both the real recompute and
 * the Admin Panel's Rescore tab dry-run preview (P9), so the two can never
 * drift apart. Pure aside from the one FIRST API fetch.
 */
export async function computeEventRescorePlan(teamId: string, eventCode: string, season: number): Promise<EventRescorePatch[]> {
  const matchLookup = await buildMatchLookup(eventCode, season);
  const entries = await getEventEntries(teamId, eventCode);

  const patches: EventRescorePatch[] = [];
  for (const entry of entries) {
    const match = matchLookup.get(matchKey(entry.matchType, entry.matchNumber)) ?? null;
    const allianceColor = match ? allianceForTeam(match, entry.teamNumber) : null;
    const allianceTeams = match && allianceColor ? (allianceColor === "red" ? match.redTeams : match.blueTeams) : [];
    const officialAllianceScore = match && allianceColor ? (allianceColor === "red" ? match.redScore : match.blueScore) : null;
    const penaltyPoints =
      match && allianceColor ? (allianceColor === "red" ? match.redPenaltyPoints : match.bluePenaltyPoints) : null;

    const sameMatchEntries = entries.filter(
      (o) => o.id !== entry.id && !o.excluded && o.matchType === entry.matchType && o.matchNumber === entry.matchNumber
    );
    const sameTeamEntries = entries.filter((o) => o.id !== entry.id && !o.excluded && o.teamNumber === entry.teamNumber);

    const accuracy = match
      ? computeAllianceAccuracy(allianceTeams, officialAllianceScore, penaltyPoints, [
          entry,
          ...sameMatchEntries.filter((o) => !o.excluded),
        ])
      : notApplicableAccuracy;

    const ctx: FlagContext = {
      match,
      allianceTeams,
      officialAllianceScore,
      allianceAccuracy: accuracy,
      sameMatchEntries,
      sameTeamEntries,
    };
    const triggeredIds = evaluateAutoFlagRuleIds(entry, ctx);
    const previouslyDismissed = new Set(entry.autoFlags.filter((f) => f.dismissed).map((f) => f.ruleId));
    const autoFlags = triggeredIds.map((ruleId) => ({ ruleId, dismissed: previouslyDismissed.has(ruleId) }));

    patches.push({
      entryId: entry.id,
      matchLabel: formatMatch(entry),
      teamNumber: entry.teamNumber,
      before: entry.accuracy ?? notApplicableAccuracy,
      after: accuracy,
      autoFlags,
    });
  }
  return patches;
}

export async function applyEventRescorePlan(patches: EventRescorePatch[]): Promise<void> {
  await Promise.all(patches.map((p) => updateEntry(p.entryId, { accuracy: p.after, autoFlags: p.autoFlags })));
}

/**
 * Recomputes accuracy + automatic flags for every entry in an event, against
 * live official match data. Run after every Scout Form submission and from
 * the Recalculate Accuracy button — recomputing the whole event (rather than
 * just the new entry) is what lets a *different* robot's entry flip from
 * "Needs Robots" to "Complete" once its alliance partner gets scouted too.
 */
export async function recomputeForEvent(teamId: string, eventCode: string, season: number): Promise<void> {
  const patches = await computeEventRescorePlan(teamId, eventCode, season);
  await applyEventRescorePlan(patches);
}

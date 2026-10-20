import { getMatchesForEvent } from "@/lib/ftc/actions";
import type { FtcMatch, MatchType } from "@/lib/ftc/types";
import { getEntriesForEvent, notApplicableAccuracy, updateEntry } from "@/lib/scout-entries";
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

/**
 * Recomputes accuracy + automatic flags for every entry in an event, against
 * live official match data. Run after every Scout Form submission and from
 * the Recalculate Accuracy button — recomputing the whole event (rather than
 * just the new entry) is what lets a *different* robot's entry flip from
 * "Needs Robots" to "Complete" once its alliance partner gets scouted too.
 */
export async function recomputeForEvent(eventCode: string, season: number): Promise<void> {
  const matchLookup = await buildMatchLookup(eventCode, season);
  const entries = getEntriesForEvent(eventCode);

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

    updateEntry(entry.id, { accuracy, autoFlags });
  }
}

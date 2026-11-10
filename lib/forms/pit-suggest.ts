import type { FtcTeam } from "@/lib/ftc/types";
import type { FormValues } from "@/lib/forms/types";

// P29: what the FIRST team data suggests for the Pit Scout Form. Only a suggestion: the scout can change it.

/** A team is a rookie in the season of its rookie year. `season` is the event's season (the year the season started). Null when FIRST gives no rookie year. */
export function isRookieIn(team: Pick<FtcTeam, "rookieYear"> | null | undefined, season: number): boolean | null {
  if (!team || team.rookieYear === null || team.rookieYear === undefined) return null;
  return team.rookieYear === season;
}

/** The values and the hint line to show when a team is chosen on a form that has a `rookie` field; null when there is nothing to suggest. */
export function rookieSuggestion(team: Pick<FtcTeam, "rookieYear"> | null | undefined, season: number): { values: FormValues; hints: Record<string, string> } | null {
  const rookie = isRookieIn(team, season);
  if (rookie === null) return null;
  return {
    values: { rookie },
    hints: { rookie: `Suggested from FIRST's data (rookie year ${team!.rookieYear}${rookie ? ", this season" : ""}). Change it if that's wrong.` },
  };
}

/** The Pit Scout Form's weight, as the one number scouts compare: pounds. */
export function weightInPounds(value: number | string | undefined, unit: string | undefined): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || value === "" || value === undefined) return null;
  return unit === "kg" ? Math.round(n * 2.20462 * 10) / 10 : n;
}

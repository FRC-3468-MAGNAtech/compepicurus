// Every tunable constant behind "Pick %" (P12), in one place.
//
// Pick % is an ESTIMATE of how likely we are to be able to pick a candidate
// team, built only from the gap between our official rank and theirs. Real
// alliance selection depends on event size, how many alliances there are, who
// declines, and strategy none of this models — so these constants are starting
// points meant to be tuned against real events, not measured truths.

/** The most likely any team can ever read (even one far below us never reads 100%: picks are never certain). */
export const MAX_PICK_PROBABILITY = 0.95;

/** `scale = max(MIN_SCALE, teamCount / TEAM_COUNT_DIVISOR)` — how many ranks below us a team has to sit before its odds climb steeply. */
export const MIN_SCALE = 4;
export const TEAM_COUNT_DIVISOR = 5;

/** A non-zero probability below this prints as "<1%" instead of rounding to "0%". */
export const TINY_PROBABILITY = 0.005;

/** The tooltip's label — it must never read like a forecast. */
export const PICK_ESTIMATE_LABEL = "Estimate, not a prediction";

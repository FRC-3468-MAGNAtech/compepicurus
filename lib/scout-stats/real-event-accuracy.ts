/**
 * P5: a scout's Real Event accuracy estimate. Real events only allow
 * comparing a full *alliance* score to the official score, so a single
 * scout's own accuracy has to be inferred — this is the one tunable place
 * that math lives, pure and unit-tested; the data-assembly side (turning
 * `scoutEntries` into `RealEventObservation[]`) lives in `engine.ts`.
 *
 * Algorithm (see the prompt's own spec):
 *   1. Each observation is one alliance-accuracy reading (0-1) a scout
 *      produced by scouting one robot in a match where both alliance
 *      robots were scouted.
 *   2. Pass 1 computes every scout's *unweighted* estimate (prior-blended
 *      plain average, ignoring partners) — used only to judge partners.
 *   3. Pass 2 re-weights each observation by its alliance partner's pass-1
 *      estimate (`weight = 0.5 + 0.5 * partnerEstimate`) and blends with
 *      whichever prior/K the caller asked for (plain, or a practice-mode
 *      prior with a stronger K).
 */

export const REAL_EVENT_ACCURACY_CONFIG = {
  /** K for the plain (All Events / {Event}) prior blend. */
  PLAIN_PRIOR_K: 2,
  /** K for the (Trial)/(Competitive) prior blend — stronger, since that prior is the scout's own data. */
  MODE_PRIOR_K: 4,
  /** Used only if the team has literally zero real-event observations anywhere (no prior to compute). */
  FALLBACK_PRIOR: 0.75,
};

export type RealEventObservation = {
  scoutUid: string;
  /** Null if no alliance partner entry could be resolved (treated as a neutral partner for weighting). */
  partnerUid: string | null;
  /** 0-1. */
  accuracy: number;
};

/** `(K * prior + sum(values)) / (K + values.length)` — the plain, unweighted blend. Empty `values` returns `prior` itself (not meant to be shown as a real per-scout estimate on its own — see `computeRealEventEstimates`). */
function priorBlend(values: number[], prior: number, k: number): number {
  if (values.length === 0) return prior;
  const sum = values.reduce((a, b) => a + b, 0);
  return (k * prior + sum) / (k + values.length);
}

function groupByScout(observations: RealEventObservation[]): Map<string, RealEventObservation[]> {
  const byScout = new Map<string, RealEventObservation[]>();
  for (const obs of observations) {
    const list = byScout.get(obs.scoutUid) ?? [];
    list.push(obs);
    byScout.set(obs.scoutUid, list);
  }
  return byScout;
}

/** The team's plain real-event accuracy average (0-1) — simple mean of every observation, regardless of scout. Falls back to `FALLBACK_PRIOR` when there are none at all. */
export function computeTeamAveragePrior(observations: RealEventObservation[]): number {
  if (observations.length === 0) return REAL_EVENT_ACCURACY_CONFIG.FALLBACK_PRIOR;
  return observations.reduce((sum, o) => sum + o.accuracy, 0) / observations.length;
}

/**
 * Every scout's Real Event accuracy estimate (0-1), for one scope (all
 * events, or one event) and one variant. `modePriors` supplies each
 * scout's own practice-mode average (0-1) for the (Trial)/(Competitive)
 * variants — a scout missing from it falls back to `teamAveragePrior`, per
 * the spec. Scouts with zero observations get `null` ("?"), never the bare
 * prior (a prior isn't a real estimate on its own).
 */
export function computeRealEventEstimates(
  observations: RealEventObservation[],
  variant: "plain" | "trial" | "competitive",
  teamAveragePrior: number,
  modePriors: Map<string, number>
): Map<string, number | null> {
  const { PLAIN_PRIOR_K, MODE_PRIOR_K } = REAL_EVENT_ACCURACY_CONFIG;
  const byScout = groupByScout(observations);

  // Pass 1: every scout's unweighted, plain-prior estimate — only ever used
  // as a stand-in for "how good is this scout's own alliance partner."
  const pass1 = new Map<string, number>();
  for (const [uid, obs] of byScout) {
    pass1.set(uid, priorBlend(obs.map((o) => o.accuracy), teamAveragePrior, PLAIN_PRIOR_K));
  }

  const prior = variant === "plain" ? teamAveragePrior : null; // resolved per-scout below for trial/competitive
  const k = variant === "plain" ? PLAIN_PRIOR_K : MODE_PRIOR_K;

  const result = new Map<string, number | null>();
  for (const [uid, obs] of byScout) {
    if (obs.length === 0) {
      result.set(uid, null);
      continue;
    }
    const scoutPrior = prior ?? modePriors.get(uid) ?? teamAveragePrior;
    let weightedSum = 0;
    let weightTotal = 0;
    for (const o of obs) {
      const partnerEstimate = o.partnerUid !== null ? (pass1.get(o.partnerUid) ?? teamAveragePrior) : teamAveragePrior;
      const weight = 0.5 + 0.5 * partnerEstimate;
      weightedSum += weight * o.accuracy;
      weightTotal += weight;
    }
    result.set(uid, (k * scoutPrior + weightedSum) / (k + weightTotal));
  }
  return result;
}

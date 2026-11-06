// Every tunable number for the Scout Status page (P16), in one place.

export const SCOUT_STATUS_CONFIG = {
  /**
   * A scout with some entries is "On track" when their progress (entries / target) is at
   * least this fraction of how much of their matches have already been played. 0.8 =
   * allowed to be up to 20% behind the schedule before turning "Behind".
   */
  ON_TRACK_FACTOR: 0.8,
  /** Upper bound on a typed target, so a typo can't make a 6-digit "target". */
  MAX_TARGET: 999,
  /** Longest a Finals range may expand to when it overrides detection. */
  MAX_FINALS_OVERRIDE: 20,
} as const;

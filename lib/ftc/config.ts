export const FTC_API_BASE_URL = process.env.FTC_API_BASE_URL ?? "https://ftc-api.firstinspires.org/v2.0";

export function getFtcCredentials() {
  const username = process.env.FTC_API_USERNAME;
  const apiKey = process.env.FTC_API_KEY;
  if (!username || !apiKey) return null;
  return { username, apiKey };
}

/** FTC seasons run roughly Sept-Apr and are named for the year they start in. */
export function getDefaultSeason(now: Date = new Date()): number {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed; 8 = September
  return month >= 8 ? year : year - 1;
}

export function getSelectableSeasons(now: Date = new Date()): number[] {
  const current = getDefaultSeason(now);
  return [current + 1, current, current - 1, current - 2];
}

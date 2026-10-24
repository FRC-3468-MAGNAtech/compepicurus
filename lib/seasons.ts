/**
 * One registry every season-select screen reads from — adding a season
 * later is adding one entry here, nothing else.
 */
export type Season = {
  id: string;
  name: string;
  /** The FIRST API's own season year (e.g. 2026 for the 2026-27 season) — see docs/ASSUMPTIONS.md (P3) for how BIOBUZZ's was determined. */
  apiSeason: number;
  /** Matches a lib/scout-form/schema.ts registry key (P2). */
  formId: string;
  enabled: boolean;
};

export const SEASONS: Season[] = [{ id: "biobuzz", name: "BIOBUZZ", apiSeason: 2026, formId: "biobuzz", enabled: true }];

export const DEFAULT_SEASON_ID = "biobuzz";

export function getSeason(id: string = DEFAULT_SEASON_ID): Season {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[0];
}

export function getEnabledSeasons(): Season[] {
  return SEASONS.filter((s) => s.enabled);
}

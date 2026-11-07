import "server-only";
import { getDefaultSeason } from "@/lib/ftc/config";
import { ftcFetch, FtcApiError } from "@/lib/ftc/http";
import { nameMatches, type ApplicationSignals } from "@/lib/applications";

type RawTeam = { teamNumber: number; nameShort?: string; nameFull?: string };

/**
 * P20: looks the applied-for FTC team up on the FIRST API for the current season, for the application's
 * verification signals. "Not found" and "the API is down" are different answers (a rookie team may not be listed
 * yet; an outage proves nothing), and neither blocks the application: they are signals for the platform owner.
 */
export async function lookupTeamForApplication(teamNumber: number, enteredName: string): Promise<ApplicationSignals["firstApi"] & { enteredName: string }> {
  const season = getDefaultSeason();
  try {
    const res = await ftcFetch<{ teams?: RawTeam[] }>(`/${season}/teams`, { teamNumber });
    const found = res.teams?.find((t) => t.teamNumber === teamNumber);
    if (!found) return { season, status: "not-found", officialName: null, nameMatches: null, enteredName };
    const official = found.nameShort ?? found.nameFull ?? null;
    const matches = enteredName ? nameMatches(enteredName, found.nameShort) || nameMatches(enteredName, found.nameFull) : null;
    return { season, status: "found", officialName: official, nameMatches: matches, enteredName };
  } catch (error) {
    if (error instanceof FtcApiError && error.code === "not_found") return { season, status: "not-found", officialName: null, nameMatches: null, enteredName };
    return { season, status: "error", officialName: null, nameMatches: null, enteredName };
  }
}

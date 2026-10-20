import type { BracketMatch, BracketRound, BracketStructure, FtcMatch } from "./types";

// FIRST's 8-alliance double-elimination playoff format uses a fixed set of
// labelled rounds. The matches API returns a human-readable `description`
// (and/or `series`) per playoff match rather than explicit bracket
// coordinates, so we group by parsing that description. Labels are matched
// loosely (case-insensitive substring) since exact wording has varied by
// season. Anything that doesn't match a known label falls through to the
// "unknown" format instead of guessing at a slot.
const UPPER_ROUND_PATTERNS = [
  { round: 1, pattern: /upper.*(round\s*1|bracket\s*1\b)/i },
  { round: 2, pattern: /upper.*(round\s*2|bracket\s*2\b)/i },
  { round: 3, pattern: /upper.*(round\s*3|bracket\s*3\b)/i },
  { round: 4, pattern: /upper.*(round\s*4|bracket\s*4\b)/i },
];

const LOWER_ROUND_PATTERNS = [
  { round: 1, pattern: /lower.*(round\s*1|bracket\s*1\b)/i },
  { round: 2, pattern: /lower.*(round\s*2|bracket\s*2\b)/i },
  { round: 3, pattern: /lower.*(round\s*3|bracket\s*3\b)/i },
  { round: 4, pattern: /lower.*(round\s*4|bracket\s*4\b)/i },
  { round: 5, pattern: /lower.*(round\s*5|bracket\s*5\b)/i },
];

const FINALS_PATTERN = /finals?/i;

function matchAllianceFromMatch(match: FtcMatch, side: "red" | "blue") {
  const teams = side === "red" ? match.redTeams : match.blueTeams;
  if (teams.length === 0) return null;
  return { seed: null, teams };
}

function toBracketMatch(label: string, match: FtcMatch | undefined): BracketMatch {
  if (!match) {
    return { label, match: null, red: null, blue: null, winner: null };
  }
  const winner =
    match.redScore !== null && match.blueScore !== null && match.played
      ? match.redScore > match.blueScore
        ? "red"
        : match.blueScore > match.redScore
          ? "blue"
          : null
      : null;
  return {
    label,
    match,
    red: matchAllianceFromMatch(match, "red"),
    blue: matchAllianceFromMatch(match, "blue"),
    winner,
  };
}

function buildRounds(
  matches: FtcMatch[],
  patterns: { round: number; pattern: RegExp }[],
  bracketName: string
): BracketRound[] {
  return patterns
    .map(({ round, pattern }) => {
      const roundMatches = matches
        .filter((m) => (m.description ?? "").match(pattern))
        .sort((a, b) => a.matchNumber - b.matchNumber);
      return {
        label: `${bracketName} Round ${round}`,
        round,
        matches: roundMatches.map((m, i) => toBracketMatch(`${bracketName} R${round}M${i + 1}`, m)),
      };
    })
    // The round numbers in FIRST's descriptions are global tournament rounds
    // shared across both brackets, not independent per-bracket counters — an
    // 8-alliance bracket genuinely has no "Upper Round 3" or "Lower Round 1"
    // match (verified against a real event). Drop the resulting empty rounds
    // rather than show placeholders for rounds that were never going to exist.
    .filter((round) => round.matches.length > 0);
}

export function buildPlayoffBracket(matches: FtcMatch[]): BracketStructure {
  if (matches.length === 0) {
    return { format: "unknown", matches };
  }

  const described = matches.filter((m) => m.description);
  const recognized = described.filter(
    (m) =>
      UPPER_ROUND_PATTERNS.some((p) => p.pattern.test(m.description!)) ||
      LOWER_ROUND_PATTERNS.some((p) => p.pattern.test(m.description!)) ||
      FINALS_PATTERN.test(m.description!)
  );

  // If we can't confidently recognize most matches as belonging to the
  // known 8-alliance double-elim shape, don't force it — surface the raw
  // matches instead so the UI can say "bracket view not available" rather
  // than render something silently wrong.
  if (recognized.length < matches.length * 0.8) {
    return { format: "unknown", matches };
  }

  const finalsMatches = matches
    .filter((m) => FINALS_PATTERN.test(m.description ?? ""))
    .sort((a, b) => a.matchNumber - b.matchNumber);

  return {
    format: "double-elim-8",
    upperBracket: buildRounds(matches, UPPER_ROUND_PATTERNS, "Upper"),
    lowerBracket: buildRounds(matches, LOWER_ROUND_PATTERNS, "Lower"),
    finals: finalsMatches.map((m, i) => toBracketMatch(`Finals ${i + 1}`, m)),
  };
}

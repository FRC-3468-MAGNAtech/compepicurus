export type RoleId =
  | "match-scout"
  | "pit-scout"
  | "pit-team"
  | "drive-team"
  | "lead-scout"
  | "lead-strategist"
  | "team-coach"
  | "media"
  | "judge-awards";

export type Role = {
  id: RoleId;
  label: string;
  /** Pill classes — same bg/text/border convention as components/ui/badge.tsx. */
  className: string;
};

// Fixed, distinct hues per role (not derived from the active theme's single
// accent) — both existing themes (team red/gold, BIOBUZZ amber) are warm,
// so role colors need to read as distinct from the theme *and* from each
// other, not a tint of it.
export const ROLES: Role[] = [
  { id: "match-scout", label: "Match Scout", className: "bg-sky-500/15 text-sky-300 border border-sky-400/30" },
  { id: "pit-scout", label: "Pit Scout", className: "bg-violet-500/15 text-violet-300 border border-violet-400/30" },
  { id: "pit-team", label: "Pit Team", className: "bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-400/30" },
  { id: "drive-team", label: "Drive Team", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30" },
  { id: "lead-scout", label: "Lead Scout", className: "bg-amber-500/15 text-amber-300 border border-amber-400/30" },
  {
    id: "lead-strategist",
    label: "Lead Strategist",
    className: "bg-orange-500/15 text-orange-300 border border-orange-400/30",
  },
  { id: "team-coach", label: "Team Coach", className: "bg-cyan-500/15 text-cyan-300 border border-cyan-400/30" },
  { id: "media", label: "Media", className: "bg-pink-500/15 text-pink-300 border border-pink-400/30" },
  { id: "judge-awards", label: "Judge Awards", className: "bg-lime-500/15 text-lime-300 border border-lime-400/30" },
];

export const DEFAULT_ROLE_ID: RoleId = "match-scout";

export function getRole(id: string): Role {
  return ROLES.find((r) => r.id === id) ?? ROLES[0];
}

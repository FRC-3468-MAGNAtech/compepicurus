import { ROLES, type RoleId } from "@/lib/roles";

// Which realtime data each role's dashboard needs, and which role to show
// (P13). Pure. The dashboard's shared provider subscribes only to the union of
// what the *role being viewed* (plus the admin strip) needs, so a Pit Scout's
// dashboard doesn't pay for the Lead Scout's roster and session listeners.
//
// Always loaded, whatever the role: the team's scout entries and the FIRST API
// data for the selected event (matches, rankings, teams) — both are cheap,
// shared, and every role's header strip uses the latter.

export type DashboardSource =
  /** `users` for the team — scout names and the accuracy leaderboard. */
  | "members"
  /** Every practice/live/lobby session — Resume banner, pending robots, recent practice, flagged-session count. */
  | "sessions"
  /** The imported match library — labels for practice sessions. */
  | "library"
  /** `eventAttendance` for the team. */
  | "attendance"
  /** The selected event's published scouting schedule. */
  | "assignments"
  /** The selected event's shared pick list. */
  | "pickList"
  /** P29: the event's form entries (Pit Scout, Team Strategy, Helper ...) for the coverage widgets. */
  | "formEntries"
  /** P31: the Pit Scouting and Team Strategy assignments (the team's docs; the widget picks the selected event's). */
  | "teamAssignments";

export const ROLE_SOURCES: Record<RoleId, DashboardSource[]> = {
  "match-scout": ["members", "sessions", "library", "assignments"],
  "pit-scout": ["formEntries", "teamAssignments"],
  "pit-team": ["formEntries"],
  "drive-team": [],
  "lead-scout": ["members", "sessions", "attendance", "assignments"],
  "lead-strategist": ["pickList", "formEntries", "teamAssignments"],
  "team-coach": ["members", "sessions", "attendance"],
  media: [],
  "judge-awards": [],
};

/** The admin strip's flagged-practice-session count reads sessions, so admins always need them. */
const ADMIN_SOURCES: DashboardSource[] = ["sessions"];

export function sourcesFor(role: RoleId, isAdmin: boolean): Set<DashboardSource> {
  return new Set<DashboardSource>([...ROLE_SOURCES[role], ...(isAdmin ? ADMIN_SOURCES : [])]);
}

const ROLE_IDS = new Set<string>(ROLES.map((r) => r.id));
export const isRoleId = (value: unknown): value is RoleId => typeof value === "string" && ROLE_IDS.has(value);

/** The user's own roles, primary first, without duplicates. */
export function userRoles(primaryRole: RoleId, secondaryRoles: RoleId[]): RoleId[] {
  return [...new Set<RoleId>([primaryRole, ...secondaryRoles.filter(isRoleId)])];
}

/**
 * The role whose widgets to show: an admin's "View as role" preview if one is
 * set; otherwise the user's last choice among *their own* roles; otherwise
 * their primary role. A remembered role they no longer hold is ignored.
 */
export function resolveViewRole(input: { primaryRole: RoleId; secondaryRoles: RoleId[]; saved: string | null; viewAs: RoleId | null }): RoleId {
  if (input.viewAs && isRoleId(input.viewAs)) return input.viewAs;
  const mine = userRoles(input.primaryRole, input.secondaryRoles);
  return input.saved && isRoleId(input.saved) && mine.includes(input.saved) ? input.saved : input.primaryRole;
}

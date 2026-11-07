// P19: pure logic for "several FTC teams under one account". No React and no Firebase, so the hooks
// (lib/field-teams-context.tsx), the server migration (lib/server/field-teams-sync.ts) and the tests all
// share it.
//
// Vocabulary: the *team account* is the `teams/{teamId}` doc (join code, owner, shared data). An *FTC
// team* is a competing team (number + name) that belongs to the account. All scouting data is shared
// across the account; assigning a member to an FTC team only changes display, defaults and filters.

export type FieldTeam = { id: string; number: number; name: string };

/** At most this many FTC teams per account (also enforced in firestore.rules). */
export const MAX_FIELD_TEAMS = 10;
export const MAX_FIELD_TEAM_NAME = 60;
export const MAX_ACCOUNT_NAME = 60;

/** The shape of the team doc fields this module reads (a `TeamDoc` satisfies it; so does raw Admin SDK data). */
export type FieldTeamSource = { fieldTeams?: unknown; number?: unknown; name?: unknown } | null | undefined;

/** The id the migration gives the account's original (single) team. Deterministic, so a half-finished or repeated migration always agrees with itself. */
export function migratedFieldTeamId(number: number): string {
  return `ft-${number}`;
}

/** An id for a team added in Settings. Never collides with `migratedFieldTeamId` (different prefix). */
export function newFieldTeamId(random: () => number = Math.random): string {
  let s = "";
  while (s.length < 8) s += Math.floor(random() * 36).toString(36);
  return `fteam_${s}`;
}

/** "35792" -> 35792. 1-5 digits, no sign/decimal, not zero. Anything else is `null`. */
export function parseFieldTeamNumber(input: string | number | null | undefined): number | null {
  const text = typeof input === "number" ? String(input) : (input ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

function isFieldTeam(value: unknown): value is FieldTeam {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.id.length > 0 && Number.isInteger(v.number) && (v.number as number) > 0 && typeof v.name === "string";
}

/**
 * The account's FTC teams, in the admin's order. Reads `fieldTeams`; until the migration has run
 * (or if it can't have, e.g. the very first load of an old team doc) it falls back to the legacy
 * single `number`/`name`, so nothing ever shows "no team" for an account that has one.
 */
export function readFieldTeams(team: FieldTeamSource): FieldTeam[] {
  if (!team) return [];
  if (Array.isArray(team.fieldTeams)) {
    const valid = team.fieldTeams.filter(isFieldTeam).map((t) => ({ id: t.id, number: t.number, name: t.name }));
    if (valid.length > 0) return valid;
  }
  const legacy = parseFieldTeamNumber(typeof team.number === "number" ? team.number : null);
  if (legacy === null) return [];
  return [{ id: migratedFieldTeamId(legacy), number: legacy, name: typeof team.name === "string" ? team.name : "" }];
}

/** "FTC 35792" — the label used everywhere (sidebar, headers, chips). */
export function fieldTeamLabel(team: Pick<FieldTeam, "number">): string {
  return `FTC ${team.number}`;
}

/** "FTC 35792 · Name", or just "FTC 35792" when it has no name. */
export function fieldTeamFullLabel(team: Pick<FieldTeam, "number" | "name">): string {
  return team.name.trim() ? `${fieldTeamLabel(team)} · ${team.name.trim()}` : fieldTeamLabel(team);
}

/** Keeps only ids that still exist, in the account's order, without duplicates. */
export function orderIds(ids: readonly string[] | null | undefined, teams: readonly FieldTeam[]): string[] {
  const wanted = new Set(ids ?? []);
  return teams.filter((t) => wanted.has(t.id)).map((t) => t.id);
}

/**
 * The FTC teams a member counts as belonging to. A member with none recorded (or only ids of teams
 * that no longer exist) counts as belonging to **all** of them — so an account with unassigned or
 * brand-new members never shows them "nowhere", and a removed team never leaves someone stranded.
 */
export function assignedFieldTeams(userFieldTeamIds: readonly string[] | null | undefined, teams: readonly FieldTeam[]): FieldTeam[] {
  const ordered = orderIds(userFieldTeamIds, teams);
  if (ordered.length === 0) return [...teams];
  const keep = new Set(ordered);
  return teams.filter((t) => keep.has(t.id));
}

/** True when the member has no explicit assignment that still resolves (so they "count as all"). */
export function isImplicitlyAllTeams(userFieldTeamIds: readonly string[] | null | undefined, teams: readonly FieldTeam[]): boolean {
  return orderIds(userFieldTeamIds, teams).length === 0;
}

/**
 * The FTC team the user is "viewing as": their saved choice if they are still assigned to it, else
 * their first assigned team. This is what makes removing the team someone was viewing safe.
 */
export function resolveActiveFieldTeam(input: {
  teams: readonly FieldTeam[];
  userFieldTeamIds?: readonly string[] | null;
  savedActiveId?: string | null;
}): FieldTeam | null {
  const assigned = assignedFieldTeams(input.userFieldTeamIds, input.teams);
  return assigned.find((t) => t.id === input.savedActiveId) ?? assigned[0] ?? null;
}

export function ourTeamNumbers(teams: readonly FieldTeam[]): ReadonlySet<number> {
  return new Set(teams.map((t) => t.number));
}

/** Is this one of the account's FTC teams (any of them, not just the one being viewed as)? */
export function isOurTeam(number: number | null | undefined, teams: readonly FieldTeam[]): boolean {
  return number !== null && number !== undefined && teams.some((t) => t.number === number);
}

// --- editing (Settings > Team Settings) --------------------------------------------------------

/** One row in the Team Settings editor: strings, because they are being typed. */
export type FieldTeamDraft = { id: string; number: string; name: string };

export type FieldTeamIssue = { id: string | null; field: "number" | "name" | "list"; message: string };

export function toDrafts(teams: readonly FieldTeam[]): FieldTeamDraft[] {
  return teams.map((t) => ({ id: t.id, number: String(t.number), name: t.name }));
}

/** Everything wrong with the draft list, empty when it is saveable. Numbers must be 1-5 digits and unique; names are optional but bounded. */
export function validateFieldTeamDrafts(drafts: readonly FieldTeamDraft[]): FieldTeamIssue[] {
  const issues: FieldTeamIssue[] = [];
  if (drafts.length === 0) issues.push({ id: null, field: "list", message: "An account needs at least one FTC team." });
  if (drafts.length > MAX_FIELD_TEAMS) issues.push({ id: null, field: "list", message: `An account can have at most ${MAX_FIELD_TEAMS} FTC teams.` });
  const seen = new Map<number, string>();
  for (const d of drafts) {
    const n = parseFieldTeamNumber(d.number);
    if (n === null) {
      issues.push({ id: d.id, field: "number", message: "Enter a team number with 1 to 5 digits." });
    } else if (seen.has(n)) {
      issues.push({ id: d.id, field: "number", message: `FTC ${n} is already on this account.` });
    } else {
      seen.set(n, d.id);
    }
    if (d.name.trim().length > MAX_FIELD_TEAM_NAME) {
      issues.push({ id: d.id, field: "name", message: `Names can be at most ${MAX_FIELD_TEAM_NAME} characters.` });
    }
  }
  return issues;
}

/** Drafts -> stored teams (call only when `validateFieldTeamDrafts` is empty). Names are trimmed. */
export function draftsToFieldTeams(drafts: readonly FieldTeamDraft[]): FieldTeam[] {
  return drafts.map((d) => ({ id: d.id, number: parseFieldTeamNumber(d.number) ?? 0, name: d.name.trim() }));
}

/** Moves one item (reordering). Out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The fields written to `teams/{teamId}` when the FTC team list changes. `number`/`name` mirror the first team so anything still reading the legacy fields keeps working; `fieldTeamIdList` is the id mirror firestore.rules checks member assignments against. */
export function fieldTeamsWrite(teams: readonly FieldTeam[]): { fieldTeams: FieldTeam[]; fieldTeamIdList: string[]; fieldTeamNumbers: number[]; number: number; name: string | null } {
  const first = teams[0];
  return {
    fieldTeams: teams.map((t) => ({ id: t.id, number: t.number, name: t.name })),
    fieldTeamIdList: teams.map((t) => t.id),
    // P20: a queryable mirror of the numbers (Firestore can't query inside a list of maps), so "does an account already
    // have this FTC team?" can be answered with array-contains when someone applies for it.
    fieldTeamNumbers: teams.map((t) => t.number),
    number: first.number,
    name: first.name.trim() ? first.name.trim() : null,
  };
}

// --- members ----------------------------------------------------------------------------------

type MemberLike = { uid: string; fieldTeamIds?: readonly string[] | null };

/** Members who list this team explicitly (the ones Settings must ask you to reassign before it can be removed). */
export function membersAssignedTo(teamId: string, members: readonly MemberLike[]): MemberLike[] {
  return members.filter((m) => (m.fieldTeamIds ?? []).includes(teamId));
}

/**
 * Where each affected member's assignment ends up when several FTC teams are removed at once, each
 * with the team its members move to (`removedToTarget`: removed id -> target id). A target that is
 * itself removed is followed on to *its* target, so removing B (-> A) and then A (-> C) lands B's
 * people on C. Members already on the target just lose the removed id; the result keeps the
 * account's order. Only members who list a removed team are returned.
 */
export function planRemovals(
  removedToTarget: Readonly<Record<string, string>>,
  members: readonly MemberLike[],
  teams: readonly FieldTeam[]
): { uid: string; before: string[]; after: string[] }[] {
  const removed = new Set(Object.keys(removedToTarget));
  const remaining = teams.filter((t) => !removed.has(t.id));
  const finalTarget = (id: string): string => {
    let current = removedToTarget[id];
    for (let hops = 0; removed.has(current) && hops < teams.length; hops++) current = removedToTarget[current];
    return current;
  };
  return members
    .filter((m) => (m.fieldTeamIds ?? []).some((id) => removed.has(id)))
    .map((m) => {
      const before = [...(m.fieldTeamIds ?? [])];
      const kept = before.filter((id) => !removed.has(id));
      const moved = before.filter((id) => removed.has(id)).map(finalTarget);
      return { uid: m.uid, before, after: orderIds([...kept, ...moved], remaining) };
    });
}

/** One member's assignment after adding/removing one team (bulk assign). Starts from what they effectively have, so removing a team from an "all teams" member leaves them on the rest. */
export function applyBulkAssignment(
  current: readonly string[] | null | undefined,
  teamId: string,
  mode: "add" | "remove",
  teams: readonly FieldTeam[]
): string[] {
  const base = assignedFieldTeams(current, teams).map((t) => t.id);
  const next = mode === "add" ? [...base, teamId] : base.filter((id) => id !== teamId);
  return orderIds(next, teams);
}

export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Does this member show up under a team filter? (Empty filter = everyone; unassigned members match any team.) */
export function matchesTeamFilter(userFieldTeamIds: readonly string[] | null | undefined, filter: readonly string[], teams: readonly FieldTeam[]): boolean {
  if (filter.length === 0) return true;
  const assigned = assignedFieldTeams(userFieldTeamIds, teams);
  return assigned.some((t) => filter.includes(t.id));
}

// --- migration (used by lib/server/field-teams-sync.ts; pure so it is unit-tested) -------------

/**
 * What to write to a team doc so it carries `fieldTeams` and its id mirror. `null` means it is
 * already complete (this is what makes the migration idempotent), or that there is nothing to
 * migrate from (no valid `fieldTeams` and no valid legacy `number`).
 */
export function planTeamMigration(
  team: (FieldTeamSource & { fieldTeamIdList?: unknown; fieldTeamNumbers?: unknown }) | null | undefined
): { fieldTeams: FieldTeam[]; fieldTeamIdList: string[]; fieldTeamNumbers: number[] } | null {
  if (!team) return null;
  const teams = readFieldTeams(team);
  if (teams.length === 0) return null;
  const ids = teams.map((t) => t.id);
  const numbers = teams.map((t) => t.number);
  const hasFieldTeams = Array.isArray(team.fieldTeams) && team.fieldTeams.length > 0 && team.fieldTeams.every(isFieldTeam);
  const mirror = Array.isArray(team.fieldTeamIdList) ? team.fieldTeamIdList : null;
  const mirrorOk = mirror !== null && mirror.length === ids.length && mirror.every((id, i) => id === ids[i]);
  const numbersMirror = Array.isArray(team.fieldTeamNumbers) ? team.fieldTeamNumbers : null;
  const numbersOk = numbersMirror !== null && numbersMirror.length === numbers.length && numbersMirror.every((n, i) => n === numbers[i]);
  if (hasFieldTeams && mirrorOk && numbersOk) return null;
  return { fieldTeams: teams, fieldTeamIdList: ids, fieldTeamNumbers: numbers };
}

/** The members that still need `fieldTeamIds` (those with no list at all) — each gets **all** the account's FTC teams, so migrating never removes anyone's view of anything. */
export function planMemberMigration(members: readonly { uid: string; fieldTeamIds?: unknown }[], teams: readonly FieldTeam[]): { uid: string; fieldTeamIds: string[] }[] {
  const all = teams.map((t) => t.id);
  return members.filter((m) => !Array.isArray(m.fieldTeamIds)).map((m) => ({ uid: m.uid, fieldTeamIds: [...all] }));
}

/** What a brand-new member (join, owner auto-attach) starts with: every FTC team on the account. */
export function defaultMemberFieldTeamIds(team: FieldTeamSource): string[] {
  return readFieldTeams(team).map((t) => t.id);
}

import { collection, collectionGroup, limit, query, where, type Firestore } from "firebase/firestore";

// Every Firestore query the Practice Scouting flows (solo, live, lobby) make,
// in one place (FIX3). Firestore rules are not filters: a list query only works
// when its constraints let the rules prove every possible result is readable, so
// each query here is written to match its rule in firestore.rules, and the rules
// regression suite (firestore.rules.test.ts, "FIX3: practice queries") runs these
// exact builders for each kind of user. Change a query or a rule → that suite tells you.

export const PRACTICE_COLLECTIONS = {
  library: "libraryMatches",
  sessions: "practiceSessions",
  liveMatches: "liveMatches",
  lobbies: "lobbies",
} as const;

/** The published matches of one season — Match Select, the lobby waiting room, Assignments. */
export const librarySeasonQuery = (db: Firestore, seasonId: string) => query(collection(db, "libraryMatches"), where("seasonId", "==", seasonId), where("published", "==", true));

/** One event's matches. Admin tables ask for everything; every scout-facing list asks for published only. */
export const libraryEventQuery = (db: Firestore, eventCode: string, includeUnpublished: boolean) =>
  includeUnpublished ? query(collection(db, "libraryMatches"), where("eventCode", "==", eventCode)) : query(collection(db, "libraryMatches"), where("eventCode", "==", eventCode), where("published", "==", true));

/** Every library match (labels, analytics, dashboards, Rescore). */
export const libraryAllQuery = (db: Firestore, includeUnpublished: boolean) => (includeUnpublished ? collection(db, "libraryMatches") : query(collection(db, "libraryMatches"), where("published", "==", true)));

export const teamSoloSessionsQuery = (db: Firestore, teamId: string) => query(collection(db, "practiceSessions"), where("teamId", "==", teamId), where("kind", "==", "solo"));

export const teamLiveSessionsQuery = (db: Firestore, teamId: string) => query(collection(db, "practiceSessions"), where("teamId", "==", teamId), where("kind", "==", "live"));

export const teamSessionsQuery = (db: Firestore, teamId: string) => query(collection(db, "practiceSessions"), where("teamId", "==", teamId));

/** The Resume banner: at most one paused session per user. */
export const ownPausedSessionQuery = (db: Firestore, teamId: string, uid: string) =>
  query(collection(db, "practiceSessions"), where("teamId", "==", teamId), where("uid", "==", uid), where("status", "==", "paused"));

/** The "Repeat Attempt" flag. */
export const completedAttemptQuery = (db: Firestore, teamId: string, uid: string, libraryMatchId: string, alliance: string) =>
  query(
    collection(db, "practiceSessions"),
    where("teamId", "==", teamId),
    where("uid", "==", uid),
    where("libraryMatchId", "==", libraryMatchId),
    where("alliance", "==", alliance),
    where("status", "==", "completed"),
    limit(1)
  );

export const lobbySessionsQuery = (db: Firestore, teamId: string, lobbyId: string) => query(collection(db, "practiceSessions"), where("teamId", "==", teamId), where("lobbyId", "==", lobbyId));

/** Who is scouting one live match. Presence docs carry `teamId`, and the query must ask for it for the rule to hold. */
export const liveMatchScoutsQuery = (db: Firestore, matchKey: string, teamId: string) => query(collection(db, "liveMatches", matchKey, "scouts"), where("teamId", "==", teamId));

/** Every active live scout on the team, across matches (the Presence panel, the live pill, the practice landing page). */
export const teamLiveScoutsQuery = (db: Firestore, teamId: string) => query(collectionGroup(db, "scouts"), where("teamId", "==", teamId));

/** A lobby's roster. */
export const lobbyPlayersQuery = (db: Firestore, lobbyId: string, teamId: string) => query(collection(db, "lobbies", lobbyId, "players"), where("teamId", "==", teamId));

/** The lobby this user is in right now (the "rejoin" check on the practice landing page). */
export const myLobbyPlayersQuery = (db: Firestore, uid: string) => query(collectionGroup(db, "players"), where("uid", "==", uid));

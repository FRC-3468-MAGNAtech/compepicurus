import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { tryClaimDoc } from "@/lib/claim-doc";
import {
  completedAttemptQuery,
  libraryAllQuery,
  libraryEventQuery,
  librarySeasonQuery,
  liveMatchScoutsQuery,
  lobbyPlayersQuery,
  lobbySessionsQuery,
  myLobbyPlayersQuery,
  ownPausedSessionQuery,
  teamLiveScoutsQuery,
  teamLiveSessionsQuery,
  teamSessionsQuery,
  teamSoloSessionsQuery,
} from "@/lib/practice-queries";
import { summarizeBulk, validateBulk } from "@/lib/library/bulk";
import { buildManualMatchDoc, emptyRawMatch, validateRawMatch } from "@/lib/library/manual-match";
import { applyPickOp, sanitizePicks, type PickOp } from "@/lib/pick-list/ops";
import { setDoc, doc, getDoc, getDocs, updateDoc, deleteDoc, deleteField, collection, addDoc, writeBatch, runTransaction, query, where, serverTimestamp, arrayUnion } from "firebase/firestore";
import { formEntryDoc, type NewFormEntry } from "@/lib/form-entries-model";

// Unverified in this environment — no Java / firebase-tools available here
// to run the Emulator Suite (see docs/ASSUMPTIONS.md, "P1: rules tests").
// Run with `npm run test:rules` once both are installed locally.

let testEnv: RulesTestEnvironment;

const TEAM_ID = "team-1";
const OWNER_UID = "owner-1";
const ADMIN_UID = "admin-1";
const SCOUT_UID = "scout-1";
const OTHER_TEAM_UID = "outsider-1";
const OTHER_TEAM_ID = "other-team"; // never actually created — used to prove cross-team isolation

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "compepicurus-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "teams", TEAM_ID), {
      number: 3468,
      name: null,
      joinCode: "ABC123",
      activeEventCode: null,
      activeSeasonId: null,
      activeEvent: null,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "users", OWNER_UID), {
      name: "Owner Person",
      email: "owner@example.com",
      teamId: TEAM_ID,
      primaryRole: "lead-scout",
      secondaryRoles: [],
      isAdmin: true,
      isOwner: true,
      themeId: "team",
    });
    await setDoc(doc(db, "users", ADMIN_UID), {
      name: "Admin Person",
      email: "admin@example.com",
      teamId: TEAM_ID,
      primaryRole: "lead-scout",
      secondaryRoles: [],
      isAdmin: true,
      isOwner: false,
      themeId: "team",
    });
    await setDoc(doc(db, "users", SCOUT_UID), {
      name: "Scout Person",
      email: "scout@example.com",
      teamId: TEAM_ID,
      primaryRole: "match-scout",
      secondaryRoles: [],
      isAdmin: false,
      isOwner: false,
      themeId: "team",
    });
  });
});

describe("teams/{teamId}", () => {
  it("is readable only by a member of that team — P1b dropped the public read", async () => {
    const memberDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(getDoc(doc(memberDb, "teams", TEAM_ID)));

    const outDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(outDb, "teams", TEAM_ID)));
  });

  it("can never be created directly by a client — only /api/team/create (Admin SDK)", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(
      setDoc(doc(db, "teams", "new-team"), {
        number: 9999,
        name: null,
        joinCode: "ZZZZZZ",
        activeEventCode: null,
        activeSeasonId: null,
        activeEvent: null,
      })
    );
  });

  it("can only be updated by an admin of that team", async () => {
    const scoutDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(scoutDb, "teams", TEAM_ID), { activeEventCode: "USNYLI" }));

    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(updateDoc(doc(adminDb, "teams", TEAM_ID), { activeEventCode: "USNYLI" }));
  });

  it("cannot be updated by an admin of a different team", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), {
        name: "Outsider Admin",
        email: "outsider@example.com",
        teamId: OTHER_TEAM_ID,
        primaryRole: "lead-scout",
        secondaryRoles: [],
        isAdmin: true,
        isOwner: false,
        themeId: "team",
      });
    });
    const db = testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
    await assertFails(updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: "USNYLI" }));
  });
});

describe("appSettings/global", () => {
  it("is denied to every client, read and write — even an owner or admin", async () => {
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(getDoc(doc(ownerDb, "appSettings", "global")));
    await assertFails(setDoc(doc(ownerDb, "appSettings", "global"), { teamCreationEnabled: true }));

    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(getDoc(doc(adminDb, "appSettings", "global")));
  });
});

describe("users/{uid}", () => {
  it("lets a signed-in teammate read another member's profile", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "users", ADMIN_UID)));
  });

  it("blocks a signed-out read", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users", ADMIN_UID)));
  });

  it("blocks a member of a different team from reading this team's profiles", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), {
        name: "Outsider",
        email: "outsider@example.com",
        teamId: OTHER_TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      });
    });
    const db = testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
    await assertFails(getDoc(doc(db, "users", SCOUT_UID)));
  });

  it("can never be created directly by a client — only /api/team/join or /api/team/create (Admin SDK)", async () => {
    const db = testEnv.authenticatedContext("new-user-1").firestore();
    await assertFails(
      setDoc(doc(db, "users", "new-user-1"), {
        name: "New Scout",
        email: "new@example.com",
        teamId: TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      })
    );
  });

  it("lets a user update their own display name and theme", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, "users", SCOUT_UID), { name: "New Name", themeId: "biobuzz" }));
  });

  it("lets a user save their own light/dark mode and any theme id (P18), but not someone else's", async () => {
    const own = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(updateDoc(doc(own, "users", SCOUT_UID), { colorMode: "light", themeId: "pride-transgender" }));
    await assertSucceeds(updateDoc(doc(own, "users", SCOUT_UID), { colorMode: "system" }));
    const outsider = testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
    await assertFails(updateDoc(doc(outsider, "users", SCOUT_UID), { colorMode: "dark" }));
  });

  it("blocks a user from granting themselves admin or owner", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { isAdmin: true }));
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { isOwner: true }));
  });

  it("blocks a user from changing their own primaryRole or secondaryRoles", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "lead-strategist" }));
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { secondaryRoles: ["media"] }));
  });

  it("blocks a user from changing their own teamId", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { teamId: OTHER_TEAM_ID }));
  });

  it("lets an admin change another (non-owner) member's role and admin status", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "pit-scout", secondaryRoles: ["media"] }));
    await assertSucceeds(updateDoc(doc(db, "users", SCOUT_UID), { isAdmin: true }));
  });

  it("blocks a non-admin from changing someone else's role", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", ADMIN_UID), { primaryRole: "pit-scout" }));
  });

  it("blocks an admin from setting isOwner on anyone via a client update", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { isOwner: true }));
  });

  it("P1b: blocks another admin from editing an owner's row at all — role, admin status, or anything else", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "pit-scout" }));
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { secondaryRoles: ["media"] }));
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { isAdmin: false }));
  });

  it("P1b/FIX2: the owner can change their own roles, but never their own admin/owner flags", async () => {
    // P1b originally blocked the owner from every role/admin write on their own row; FIX2 found that locked the
    // owner out of Team Management (see the FIX2 tests below for the full matrix). Owner status itself is still
    // env-var-driven via app/api/auth/sync-roles (Admin SDK) only, and admin stays on.
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { isAdmin: false }));
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { isOwner: false }));
    await assertSucceeds(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "pit-scout" }));
    await assertSucceeds(updateDoc(doc(db, "users", OWNER_UID), { name: "Still Owner" }));
  });
});

async function seedEntry(testEnv: RulesTestEnvironment, data: Record<string, unknown>): Promise<string> {
  let id = "";
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const ref = await addDoc(collection(ctx.firestore(), "scoutEntries"), data);
    id = ref.id;
  });
  return id;
}

describe("scoutEntries/{entryId}", () => {
  const baseEntry = {
    teamId: TEAM_ID,
    source: "event" as const,
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "Scout Person",
    eventCode: "USNYLI",
    matchType: "Qualification" as const,
    matchNumber: 1,
    teamNumber: 3468,
    fields: {},
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: new Date().toISOString(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    createdAt: new Date(),
  };

  it("lets a team member create an entry as themselves", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(addDoc(collection(db, "scoutEntries"), { ...baseEntry, uid: SCOUT_UID }));
  });

  it("blocks creating an entry under someone else's uid", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(addDoc(collection(db, "scoutEntries"), { ...baseEntry, uid: ADMIN_UID }));
  });

  it("blocks creating an entry for a different team", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(addDoc(collection(db, "scoutEntries"), { ...baseEntry, uid: SCOUT_UID, teamId: OTHER_TEAM_ID }));
  });

  it("lets any team member read entries for their team", async () => {
    const entryId = await seedEntry(testEnv, { ...baseEntry, uid: SCOUT_UID });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "scoutEntries", entryId)));
  });

  it("blocks the author (a non-admin) from updating or deleting their own entry", async () => {
    const entryId = await seedEntry(testEnv, { ...baseEntry, uid: SCOUT_UID });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(db, "scoutEntries", entryId), { excluded: true }));
    await assertFails(deleteDoc(doc(db, "scoutEntries", entryId)));
  });

  it("lets an admin update or delete any entry on their team", async () => {
    const entryId = await seedEntry(testEnv, { ...baseEntry, uid: SCOUT_UID });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, "scoutEntries", entryId), { excluded: true }));
    await assertSucceeds(deleteDoc(doc(db, "scoutEntries", entryId)));
  });
});

describe("practiceSessions/{sessionId} (P3)", () => {
  const baseSession = {
    teamId: TEAM_ID,
    kind: "solo" as const,
    seasonId: "biobuzz",
    mode: "trial" as const,
    difficulty: null,
    libraryMatchId: null,
    eventCode: null,
    alliance: null,
    robots: [],
    status: "in-progress" as const,
    completedRobots: [],
    entryIds: [],
    accuracy: null,
    scoutedTotal: null,
    penaltyPoints: null,
    officialScore: null,
    platform: "pc" as const,
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  it("lets a team member claim/create a session as themselves", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "practiceSessions", "PS-ABCDEF"), { ...baseSession, uid: SCOUT_UID }));
  });

  it("blocks creating a session under someone else's uid", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(setDoc(doc(db, "practiceSessions", "PS-BADUID"), { ...baseSession, uid: ADMIN_UID }));
  });

  it("lets any team member read any session (leaderboards)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-READ01"), { ...baseSession, uid: SCOUT_UID });
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "practiceSessions", "PS-READ01")));
  });

  it("lets the owner keep updating their own session while in-progress/paused", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-OWN0001"), { ...baseSession, uid: SCOUT_UID, status: "paused" });
    });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, "practiceSessions", "PS-OWN0001"), { status: "in-progress" }));
  });

  it("blocks the owner from updating their own session once it's completed — only an admin can", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DONE001"), { ...baseSession, uid: SCOUT_UID, status: "completed" });
    });
    const scoutDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(scoutDb, "practiceSessions", "PS-DONE001"), { excluded: true }));

    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(updateDoc(doc(adminDb, "practiceSessions", "PS-DONE001"), { excluded: true }));
  });

  it("blocks a teammate (non-admin, non-owner) from updating someone else's session", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-OTHR001"), { ...baseSession, uid: SCOUT_UID });
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", "scout-2"), {
        name: "Scout Two",
        email: "scout2@example.com",
        teamId: TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      });
    });
    const db = testEnv.authenticatedContext("scout-2").firestore();
    await assertFails(updateDoc(doc(db, "practiceSessions", "PS-OTHR001"), { status: "completed" }));
  });

  it("P4: lets the owner delete their own in-progress or paused session", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DEL0001"), { ...baseSession, uid: SCOUT_UID, status: "in-progress" });
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DEL0002"), { ...baseSession, uid: SCOUT_UID, status: "paused" });
    });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(deleteDoc(doc(db, "practiceSessions", "PS-DEL0001")));
    await assertSucceeds(deleteDoc(doc(db, "practiceSessions", "PS-DEL0002")));
  });

  it("blocks its own owner (non-admin) from deleting a completed session", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DEL0003"), { ...baseSession, uid: SCOUT_UID, status: "completed" });
    });
    const ownerDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(deleteDoc(doc(ownerDb, "practiceSessions", "PS-DEL0003")));
  });

  it("P5: lets an admin delete a completed session (Hard Reset Scout Data)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DEL0005"), { ...baseSession, uid: SCOUT_UID, status: "completed" });
    });
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(deleteDoc(doc(adminDb, "practiceSessions", "PS-DEL0005")));
  });

  it("P5: still blocks an admin from deleting someone else's in-progress/paused session", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DEL0006"), { ...baseSession, uid: SCOUT_UID, status: "in-progress" });
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DEL0007"), { ...baseSession, uid: SCOUT_UID, status: "paused" });
    });
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(adminDb, "practiceSessions", "PS-DEL0006")));
    await assertFails(deleteDoc(doc(adminDb, "practiceSessions", "PS-DEL0007")));
  });

  it("P4: blocks a teammate from deleting someone else's in-progress session", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-DEL0004"), { ...baseSession, uid: SCOUT_UID, status: "in-progress" });
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(db, "practiceSessions", "PS-DEL0004")));
  });
});

describe("libraryMatches/{matchId} (P3)", () => {
  const baseMatch = {
    seasonId: "biobuzz",
    eventCode: "USWABON1",
    eventName: "Rookie Rumble",
    matchType: "Qualification" as const,
    matchNumber: 1,
    alliances: {
      red: { teams: [100, 200], score: 150, penaltyPoints: 0, difficulty: "medium" as const },
      blue: { teams: [300, 400], score: 50, penaltyPoints: 0, difficulty: "easy" as const },
    },
    video: null,
    // P15: every library match carries these now (the import writes them; the backfill stamps older docs).
    origin: "api" as const,
    published: true,
    importedAt: new Date().toISOString(),
    scoresUpdatedAt: new Date().toISOString(),
  };

  it("is readable by any signed-in user, not just the importing admin's team", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "libraryMatches", "USWABON1_Q1"), baseMatch);
    });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "libraryMatches", "USWABON1_Q1")));
  });

  it("blocks a signed-out read", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "libraryMatches", "USWABON1_Q2"), baseMatch);
    });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "libraryMatches", "USWABON1_Q2")));
  });

  it("blocks a non-admin from writing", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(setDoc(doc(db, "libraryMatches", "USWABON1_Q3"), baseMatch));
  });

  it("lets an admin write", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "libraryMatches", "USWABON1_Q4"), baseMatch));
  });
});

describe("eventAttendance/{teamId}_{eventCode} (P6)", () => {
  it("lets a team member read", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "eventAttendance", `${TEAM_ID}_USWABON1`), {
        teamId: TEAM_ID,
        eventCode: "USWABON1",
        uids: [SCOUT_UID],
      });
    });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "eventAttendance", `${TEAM_ID}_USWABON1`)));
  });

  it("blocks a cross-team read", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "eventAttendance", `${TEAM_ID}_USWABON2`), {
        teamId: TEAM_ID,
        eventCode: "USWABON2",
        uids: [SCOUT_UID],
      });
      await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), {
        name: "Outsider",
        email: "outsider@example.com",
        teamId: OTHER_TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      });
    });
    const db = testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
    await assertFails(getDoc(doc(db, "eventAttendance", `${TEAM_ID}_USWABON2`)));
  });

  it("lets an admin create/update the attendance list", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, "eventAttendance", `${TEAM_ID}_USWABON3`), { teamId: TEAM_ID, eventCode: "USWABON3", uids: [SCOUT_UID, ADMIN_UID] })
    );
  });

  it("blocks a non-admin from writing", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(
      setDoc(doc(db, "eventAttendance", `${TEAM_ID}_USWABON4`), { teamId: TEAM_ID, eventCode: "USWABON4", uids: [SCOUT_UID] })
    );
  });

  it("blocks deleting", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "eventAttendance", `${TEAM_ID}_USWABON5`), {
        teamId: TEAM_ID,
        eventCode: "USWABON5",
        uids: [],
      });
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(db, "eventAttendance", `${TEAM_ID}_USWABON5`)));
  });
});

describe("auditLog/{id} (P5)", () => {
  const entry = {
    teamId: TEAM_ID,
    uid: ADMIN_UID,
    actorName: "Admin Person",
    action: "hard-reset-scout-data",
    target: { targetUid: SCOUT_UID },
    before: {},
    after: {},
    createdAt: new Date(),
  };

  it("lets an admin create an entry as themselves", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(addDoc(collection(db, "auditLog"), entry));
  });

  it("blocks a non-admin from creating an entry", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(addDoc(collection(db, "auditLog"), { ...entry, uid: SCOUT_UID }));
  });

  it("blocks creating an entry under someone else's uid", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(addDoc(collection(db, "auditLog"), { ...entry, uid: SCOUT_UID }));
  });

  it("lets an admin read, blocks a non-admin from reading", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "auditLog", "log1"), entry);
    });
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(adminDb, "auditLog", "log1")));

    const scoutDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(getDoc(doc(scoutDb, "auditLog", "log1")));
  });

  it("blocks update and delete entirely, even by an admin", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "auditLog", "log2"), entry);
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "auditLog", "log2"), { actorName: "Changed" }));
    await assertFails(deleteDoc(doc(db, "auditLog", "log2")));
  });
});

describe("assignments/{teamId}_{eventCode} (P6)", () => {
  const version = {
    generatedBy: ADMIN_UID,
    generatedAt: new Date().toISOString(),
    settings: { matchSource: "event", seasonId: null, difficulty: null, rangesText: "", categories: ["Qualification"], pattern: "rotate-each-match", intervalSize: null, scoutUids: [SCOUT_UID], prioritizedTeams: [], seed: 1 },
    slots: [],
    counts: {},
    fair: true,
    warning: null,
  };

  it("lets an admin create a schedule", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "assignments", `${TEAM_ID}_USWABON1`), { teamId: TEAM_ID, eventCode: "USWABON1", current: version, previous: null }));
  });

  it("blocks a non-admin from creating a schedule", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(setDoc(doc(db, "assignments", `${TEAM_ID}_USWABON2`), { teamId: TEAM_ID, eventCode: "USWABON2", current: version, previous: null }));
  });

  it("lets any team member (not just admins) read the published schedule", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "assignments", `${TEAM_ID}_USWABON3`), { teamId: TEAM_ID, eventCode: "USWABON3", current: version, previous: null });
    });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "assignments", `${TEAM_ID}_USWABON3`)));
  });

  it("blocks deleting", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "assignments", `${TEAM_ID}_USWABON4`), { teamId: TEAM_ID, eventCode: "USWABON4", current: version, previous: null });
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(db, "assignments", `${TEAM_ID}_USWABON4`)));
  });
});

describe("liveMatches/{matchKey}/scouts/{uid} (P7)", () => {
  const presence = { uid: SCOUT_UID, teamId: TEAM_ID, name: "Scout One", robot: 100, alliance: "red", sessionId: "LV-ABCDEF", lastSeen: new Date() };

  it("lets a scout create their own presence doc", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "liveMatches", "USWABON1_Q1", "scouts", SCOUT_UID), presence));
  });

  it("blocks creating a presence doc under someone else's uid", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(setDoc(doc(db, "liveMatches", "USWABON1_Q1", "scouts", ADMIN_UID), { ...presence, uid: ADMIN_UID }));
  });

  it("lets a teammate read presence, blocks a cross-team read", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "liveMatches", "USWABON1_Q2", "scouts", SCOUT_UID), presence);
      await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), {
        name: "Outsider",
        email: "outsider@example.com",
        teamId: OTHER_TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      });
    });
    const teammateDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(teammateDb, "liveMatches", "USWABON1_Q2", "scouts", SCOUT_UID)));

    const outsiderDb = testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
    await assertFails(getDoc(doc(outsiderDb, "liveMatches", "USWABON1_Q2", "scouts", SCOUT_UID)));
  });

  it("lets a scout delete (leave) their own presence", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "liveMatches", "USWABON1_Q3", "scouts", SCOUT_UID), presence);
    });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(deleteDoc(doc(db, "liveMatches", "USWABON1_Q3", "scouts", SCOUT_UID)));
  });

  it("blocks deleting someone else's presence", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "liveMatches", "USWABON1_Q4", "scouts", SCOUT_UID), presence);
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(db, "liveMatches", "USWABON1_Q4", "scouts", SCOUT_UID)));
  });
});

describe("notifications/{id} (P7)", () => {
  const notification = { teamId: TEAM_ID, uid: SCOUT_UID, sessionId: "LV-ABCDEF", type: "live-score-ready", title: "Scores are available", body: "...", read: false, createdAt: new Date() };

  it("lets a scout read their own notification", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "notifications", "LV-ABCDEF"), notification);
    });
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "notifications", "LV-ABCDEF")));
  });

  it("blocks a teammate from reading someone else's notification", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "notifications", "LV-ABCDEF"), notification);
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(getDoc(doc(db, "notifications", "LV-ABCDEF")));
  });

  it("blocks every client write, even an admin's", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(setDoc(doc(db, "notifications", "LV-OTHER01"), notification));
  });
});

describe("lobbies/{lobbyId} (P8)", () => {
  const baseLobby = {
    teamId: TEAM_ID,
    hostUid: SCOUT_UID,
    hostName: "Scout Person",
    seasonId: "biobuzz",
    mode: "trial",
    status: "waiting",
    libraryMatchId: null,
    settings: { hostScouts: true, hostIsDisplayer: false },
    pairing: null,
    startsAt: null,
    hostLastSeen: new Date(),
    createdAt: new Date(),
    resolvedAt: null,
  };

  it("lets anyone create a lobby as its own host", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "lobbies", "LB-ABCDEF"), baseLobby));
  });

  it("blocks creating a lobby with someone else as hostUid", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(setDoc(doc(db, "lobbies", "LB-BADHOST"), { ...baseLobby, hostUid: ADMIN_UID }));
  });

  it("lets a teammate read a lobby (so Join with code can look it up), blocks a cross-team read", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "lobbies", "LB-READ01"), baseLobby);
      await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), {
        name: "Outsider",
        email: "outsider@example.com",
        teamId: OTHER_TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      });
    });
    const teammateDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(teammateDb, "lobbies", "LB-READ01")));

    const outsiderDb = testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
    await assertFails(getDoc(doc(outsiderDb, "lobbies", "LB-READ01")));
  });

  it("lets the host update the lobby doc (settings/match/pairing/status)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "lobbies", "LB-HOST001"), baseLobby);
    });
    const hostDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(updateDoc(doc(hostDb, "lobbies", "LB-HOST001"), { status: "scouting" }));
  });

  it("blocks a non-host teammate from updating the lobby doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "lobbies", "LB-HOST002"), baseLobby);
    });
    const otherDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(otherDb, "lobbies", "LB-HOST002"), { status: "closed" }));
  });

  it("blocks deleting a lobby outright", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "lobbies", "LB-DEL0001"), baseLobby);
    });
    const hostDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(deleteDoc(doc(hostDb, "lobbies", "LB-DEL0001")));
  });
});

describe("lobbies/{lobbyId}/players/{uid} (P8)", () => {
  it("lets a player create/update their own player doc", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, "lobbies", "LB-PLAYER1", "players", SCOUT_UID), {
        uid: SCOUT_UID,
        teamId: TEAM_ID,
        name: "Scout Person",
        joinedAt: new Date(),
        lastSeen: new Date(),
        submitted: false,
      })
    );
  });

  it("blocks creating a player doc under someone else's uid", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(
      setDoc(doc(db, "lobbies", "LB-PLAYER2", "players", ADMIN_UID), {
        uid: ADMIN_UID,
        teamId: TEAM_ID,
        name: "Admin Person",
        joinedAt: new Date(),
        lastSeen: new Date(),
        submitted: false,
      })
    );
  });

  it("lets a teammate read the player list, blocks a cross-team read", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "lobbies", "LB-PLAYER3", "players", SCOUT_UID), {
        uid: SCOUT_UID,
        teamId: TEAM_ID,
        name: "Scout Person",
        joinedAt: new Date(),
        lastSeen: new Date(),
        submitted: false,
      });
      await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), {
        name: "Outsider",
        email: "outsider@example.com",
        teamId: OTHER_TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      });
    });
    const teammateDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(teammateDb, "lobbies", "LB-PLAYER3", "players", SCOUT_UID)));

    const outsiderDb = testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
    await assertFails(getDoc(doc(outsiderDb, "lobbies", "LB-PLAYER3", "players", SCOUT_UID)));
  });

  it("lets a player delete (leave) their own player doc, blocks deleting someone else's", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "lobbies", "LB-PLAYER4", "players", SCOUT_UID), {
        uid: SCOUT_UID,
        teamId: TEAM_ID,
        name: "Scout Person",
        joinedAt: new Date(),
        lastSeen: new Date(),
        submitted: false,
      });
    });
    const otherDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(otherDb, "lobbies", "LB-PLAYER4", "players", SCOUT_UID)));

    const ownDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(deleteDoc(doc(ownDb, "lobbies", "LB-PLAYER4", "players", SCOUT_UID)));
  });

  it("4-player scenario: two players join, host starts (writes pairing to the lobby doc), both players create their own sessions, and a non-host teammate can read the whole room", async () => {
    const PLAYER3_UID = "player-3";
    const PLAYER4_UID = "player-4";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "lobbies", "LB-ROOM001"), {
        teamId: TEAM_ID,
        hostUid: SCOUT_UID,
        hostName: "Scout Person",
        seasonId: "biobuzz",
        mode: "trial",
        status: "waiting",
        libraryMatchId: null,
        settings: { hostScouts: false, hostIsDisplayer: false },
        pairing: null,
        startsAt: null,
        hostLastSeen: new Date(),
        createdAt: new Date(),
        resolvedAt: null,
      });
      for (const uid of [PLAYER3_UID, PLAYER4_UID]) {
        await setDoc(doc(ctx.firestore(), "users", uid), {
          name: uid,
          email: `${uid}@example.com`,
          teamId: TEAM_ID,
          primaryRole: "match-scout",
          secondaryRoles: [],
          isAdmin: false,
          isOwner: false,
          themeId: "team",
        });
      }
    });

    // Four players join (ADMIN_UID, SCOUT_UID as host-but-not-scouting here
    // is fine since hostScouts is false — PLAYER3/PLAYER4 plus ADMIN_UID
    // are the three scouting players for this test's purpose; a real round
    // needs an even 4+, so we seed 4 distinct joins regardless).
    for (const uid of [ADMIN_UID, OWNER_UID, PLAYER3_UID, PLAYER4_UID]) {
      const playerDb = testEnv.authenticatedContext(uid).firestore();
      await assertSucceeds(
        setDoc(doc(playerDb, "lobbies", "LB-ROOM001", "players", uid), {
          uid,
          teamId: TEAM_ID,
          name: uid,
          joinedAt: new Date(),
          lastSeen: new Date(),
          submitted: false,
        })
      );
    }

    // Host starts: writes the full pairing onto the lobby doc.
    const hostDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(hostDb, "lobbies", "LB-ROOM001"), {
        status: "scouting",
        libraryMatchId: "USWABON1_Q1",
        startsAt: new Date().toISOString(),
        pairing: [
          { pairId: "pair-1", playerUids: [ADMIN_UID, OWNER_UID], alliance: "red", robotForUid: { [ADMIN_UID]: 100, [OWNER_UID]: 200 } },
          { pairId: "pair-2", playerUids: [PLAYER3_UID, PLAYER4_UID], alliance: "blue", robotForUid: { [PLAYER3_UID]: 300, [PLAYER4_UID]: 400 } },
        ],
      })
    );

    // A non-host teammate (not even a player here) can read the lobby and its players.
    const observerDb = testEnv.authenticatedContext("observer-1").firestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", "observer-1"), {
        name: "Observer",
        email: "observer@example.com",
        teamId: TEAM_ID,
        primaryRole: "match-scout",
        secondaryRoles: [],
        isAdmin: false,
        isOwner: false,
        themeId: "team",
      });
    });
    await assertSucceeds(getDoc(doc(observerDb, "lobbies", "LB-ROOM001")));
    await assertSucceeds(getDoc(doc(observerDb, "lobbies", "LB-ROOM001", "players", PLAYER3_UID)));

    // Each of the two scouting pairs creates its own practiceSessions doc.
    const baseLobbySession = {
      teamId: TEAM_ID,
      kind: "lobby",
      seasonId: "biobuzz",
      mode: "trial",
      difficulty: null,
      libraryMatchId: "USWABON1_Q1",
      eventCode: "USWABON1",
      status: "in-progress",
      completedRobots: [],
      entryIds: [],
      accuracy: null,
      scoutedTotal: null,
      penaltyPoints: null,
      officialScore: null,
      platform: "pc",
      flags: [],
      excluded: false,
      lobbyId: "LB-ROOM001",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      matchType: null,
      matchNumber: null,
      allianceTeams: [100, 200],
      streamUrl: null,
      streamStartSec: null,
      streamEndSec: null,
    };
    const player3Db = testEnv.authenticatedContext(PLAYER3_UID).firestore();
    await assertSucceeds(
      setDoc(doc(player3Db, "practiceSessions", "LB-SESS001"), {
        ...baseLobbySession,
        uid: PLAYER3_UID,
        scoutName: "player-3",
        alliance: "blue",
        robots: [300],
        pairId: "pair-2",
        allianceTeams: [300, 400],
      })
    );

    // player-3 can't write player-4's session.
    await assertFails(
      setDoc(doc(player3Db, "practiceSessions", "LB-SESS002"), {
        ...baseLobbySession,
        uid: PLAYER4_UID,
        scoutName: "player-4",
        alliance: "blue",
        robots: [400],
        pairId: "pair-2",
        allianceTeams: [300, 400],
      })
    );
  });
});

describe("FIX1: teams/{teamId} active events", () => {
  const EVENT_A = { code: "USWABON1", season: 2025, name: "Bonney Lake" };
  const EVENT_B = { code: "USWASEQ", season: 2025, name: "Seattle Qualifier" };

  it("lets an admin set several active events with the primary first (FIX4)", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "teams", TEAM_ID), {
        activeEventCode: "USWASEQ",
        activeSeasonId: 2025,
        activeEvent: EVENT_B,
        activeEventCodes: ["USWASEQ", "USWABON1"],
        activeEvents: [EVENT_B, EVENT_A],
      })
    );
  });

  it("FIX4: refuses a primary that is in the list but not first, and a reorder that leaves the primary behind", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "teams", TEAM_ID), {
        activeEventCode: "USWASEQ",
        activeSeasonId: 2025,
        activeEvent: EVENT_B,
        activeEventCodes: ["USWABON1", "USWASEQ"],
        activeEvents: [EVENT_A, EVENT_B],
      })
    );
  });

  it("lets an admin clear every active event", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "teams", TEAM_ID), {
        activeEventCode: null,
        activeSeasonId: null,
        activeEvent: null,
        activeEventCodes: [],
        activeEvents: [],
      })
    );
  });

  it("blocks a non-admin from setting active events", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: "USWABON1", activeEventCodes: ["USWABON1"], activeEvents: [EVENT_A] })
    );
  });

  it("blocks a primary that is not in the list", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: "USWASEQ", activeEventCodes: ["USWABON1"], activeEvents: [EVENT_A] })
    );
  });

  it("blocks a list when there is no primary, and a primary with an empty list", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: null, activeEventCodes: ["USWABON1"], activeEvents: [EVENT_A] }));
    await assertFails(updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: "USWABON1", activeEventCodes: [], activeEvents: [] }));
  });

  it("blocks more than 10 active events", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const codes = Array.from({ length: 11 }, (_, i) => `EVT${i}`);
    await assertFails(
      updateDoc(doc(db, "teams", TEAM_ID), {
        activeEventCode: "EVT0",
        activeEventCodes: codes,
        activeEvents: codes.map((code) => ({ ...EVENT_A, code })),
      })
    );
    await assertSucceeds(
      updateDoc(doc(db, "teams", TEAM_ID), {
        activeEventCode: "EVT0",
        activeEventCodes: codes.slice(0, 10),
        activeEvents: codes.slice(0, 10).map((code) => ({ ...EVENT_A, code })),
      })
    );
  });

  it("blocks activeEventCodes that is not a list", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: "USWABON1", activeEventCodes: "USWABON1" }));
  });

  it("blocks activeEvents whose length does not match activeEventCodes", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: "USWABON1", activeEventCodes: ["USWABON1", "USWASEQ"], activeEvents: [EVENT_A] })
    );
  });

  it("blocks an old-style single-event write that would leave the list out of sync with the primary", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "teams", TEAM_ID), {
        activeEventCode: "USWABON1",
        activeEventCodes: ["USWABON1"],
        activeEvents: [EVENT_A],
      });
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "teams", TEAM_ID), { activeEventCode: "USWASEQ" }));
  });
});

describe("FIX1: Team Management role editing", () => {
  it("lets an admin change another member's primary role, secondary roles, and admin flag", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "drive-team", secondaryRoles: ["media", "pit-scout"], isAdmin: true })
    );
  });

  it("lets an admin edit their own roles (admin status has its own last-admin test)", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, "users", ADMIN_UID), { primaryRole: "lead-strategist", secondaryRoles: ["team-coach"] }));
  });

  it("blocks a non-admin from editing anyone's roles or admin flag, their own included", async () => {
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "lead-scout" }));
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { isAdmin: true }));
    await assertFails(updateDoc(doc(db, "users", ADMIN_UID), { secondaryRoles: ["media"] }));
    await assertFails(updateDoc(doc(db, "users", ADMIN_UID), { isAdmin: false }));
  });

  it("protects an owner: no admin can change their roles or admin status", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "media" }));
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { secondaryRoles: ["media"] }));
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { isAdmin: false }));
  });

  it("lets an owner edit their own roles (FIX2) but never remove their own admin status", async () => {
    // FIX1 locked an owner's row for the owner too — that was the FIX2 bug. The full matrix is in the FIX2 tests below.
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, "users", OWNER_UID), { secondaryRoles: ["media"] }));
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { isAdmin: false }));
  });

  it("last-admin safeguard: an admin cannot remove their own admin flag", async () => {
    // Rules cannot count admins, but a self-demotion is the only way the last admin could ever be demoted.
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(adminDb, "users", ADMIN_UID), { isAdmin: false }));
  });

  it("last-admin safeguard: another admin can still demote an admin, and the demoted one loses admin rights", async () => {
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(updateDoc(doc(ownerDb, "users", ADMIN_UID), { isAdmin: false }));
    const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(adminDb, "users", SCOUT_UID), { primaryRole: "media" }));
  });

  it("two admins cannot demote each other: the second write no longer passes isAdmin()", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { isAdmin: true });
    });
    const aDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const bDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(updateDoc(doc(aDb, "users", SCOUT_UID), { isAdmin: false }));
    await assertFails(updateDoc(doc(bDb, "users", ADMIN_UID), { isAdmin: false }));
  });

  it("blocks a role id that is not one of the team's roles", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "supreme-leader" }));
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { secondaryRoles: ["media", "supreme-leader"] }));
  });

  it("blocks a malformed role write (secondaryRoles not a list, isAdmin not a boolean)", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { secondaryRoles: "media" }));
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { isAdmin: "yes" }));
  });

  it("blocks an admin from moving a member to a different team", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { teamId: OTHER_TEAM_ID }));
  });
});

describe("FIX1: role change + audit entry in one batch (lib/team-members.ts updateMemberAccess)", () => {
  it("lets an admin commit a role change and its audit entry together", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, "users", SCOUT_UID), { primaryRole: "drive-team", secondaryRoles: ["media"] });
    batch.set(doc(collection(db, "auditLog")), {
      teamId: TEAM_ID,
      uid: ADMIN_UID,
      actorName: "Admin Person",
      action: "edit-member-roles",
      target: { targetUid: SCOUT_UID, targetName: "Scout Person" },
      before: { primaryRole: "match-scout", secondaryRoles: [], isAdmin: false },
      after: { primaryRole: "drive-team", secondaryRoles: ["media"], isAdmin: false },
      createdAt: new Date(),
    });
    await assertSucceeds(batch.commit());
  });

  it("rejects the whole batch when the role change is not allowed, so no orphan audit entry is written", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const auditRef = doc(collection(db, "auditLog"));
    const batch = writeBatch(db);
    batch.update(doc(db, "users", OWNER_UID), { primaryRole: "media" });
    batch.set(auditRef, { teamId: TEAM_ID, uid: ADMIN_UID, actorName: "Admin Person", action: "edit-member-roles", target: {}, before: null, after: null, createdAt: new Date() });
    await assertFails(batch.commit());

    // The owner's row is untouched — and with the batch rejected, so is the audit log.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "users", OWNER_UID));
      expect(snap.data()?.primaryRole).toBe("lead-scout");
    });
  });
});

describe("P12: pickLists/{teamId}_{eventCode}", () => {
  const STRATEGIST_UID = "strategist-1"; // primary: lead-strategist
  const COACH_UID = "coach-1"; // primary match-scout, SECONDARY team-coach
  const OUTSIDER_UID = "pick-outsider-1";
  const EVENT = "USWABON1";
  const LIST_ID = `${TEAM_ID}_${EVENT}`;

  const listData = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    eventCode: EVENT,
    picked: [254, 971],
    updatedBy: STRATEGIST_UID,
    updatedByName: "Strategist Person",
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = { email: "x@example.com", isAdmin: false, isOwner: false, themeId: "team" };
      await setDoc(doc(db, "users", STRATEGIST_UID), { ...base, name: "Strategist Person", teamId: TEAM_ID, primaryRole: "lead-strategist", secondaryRoles: [] });
      await setDoc(doc(db, "users", COACH_UID), { ...base, name: "Coach Person", teamId: TEAM_ID, primaryRole: "match-scout", secondaryRoles: ["media", "team-coach"] });
      await setDoc(doc(db, "users", OUTSIDER_UID), { ...base, name: "Outsider", teamId: OTHER_TEAM_ID, primaryRole: "lead-strategist", secondaryRoles: [], isAdmin: true });
    });
  });

  const seedList = async () =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "pickLists", LIST_ID), listData());
    });

  it("lets any teammate read — including a list that doesn't exist yet", async () => {
    const scoutDb = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertSucceeds(getDoc(doc(scoutDb, "pickLists", LIST_ID))); // missing doc: must not be denied
    await seedList();
    await assertSucceeds(getDoc(doc(scoutDb, "pickLists", LIST_ID)));
  });

  it("blocks another team's members and signed-out users from reading", async () => {
    await seedList();
    await assertFails(getDoc(doc(testEnv.authenticatedContext(OUTSIDER_UID).firestore(), "pickLists", LIST_ID)));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "pickLists", LIST_ID)));
  });

  it("lets an admin create the list", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "pickLists", LIST_ID), listData({ updatedBy: ADMIN_UID })));
  });

  it("lets a Lead Strategist (primary role) create and then update it", async () => {
    const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "pickLists", LIST_ID), listData()));
    await assertSucceeds(setDoc(doc(db, "pickLists", LIST_ID), listData({ picked: [971, 254, 118] })));
  });

  it("lets a member whose SECONDARY role is Team Coach edit it", async () => {
    await seedList();
    const db = testEnv.authenticatedContext(COACH_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "pickLists", LIST_ID), listData({ updatedBy: COACH_UID, picked: [971] })));
  });

  it("makes it read-only for everyone else", async () => {
    await seedList();
    const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(setDoc(doc(db, "pickLists", `${TEAM_ID}_NEWEVENT`), listData({ eventCode: "NEWEVENT", updatedBy: SCOUT_UID })));
    await assertFails(updateDoc(doc(db, "pickLists", LIST_ID), { picked: [1], updatedBy: SCOUT_UID, updatedByName: "Scout Person" }));
  });

  it("blocks another team's admin from writing to our list", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER_UID).firestore();
    await assertFails(setDoc(doc(db, "pickLists", LIST_ID), listData({ updatedBy: OUTSIDER_UID })));
  });

  it("requires the doc id to be {teamId}_{eventCode}", async () => {
    const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
    await assertFails(setDoc(doc(db, "pickLists", `${TEAM_ID}_WRONG`), listData()));
    await assertFails(setDoc(doc(db, "pickLists", "arbitrary-id"), listData()));
  });

  it("requires updatedBy to be the writer", async () => {
    const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
    await assertFails(setDoc(doc(db, "pickLists", LIST_ID), listData({ updatedBy: ADMIN_UID })));
  });

  it("requires picked to be a list of at most 100", async () => {
    const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
    await assertFails(setDoc(doc(db, "pickLists", LIST_ID), listData({ picked: "254" })));
    await assertFails(setDoc(doc(db, "pickLists", LIST_ID), listData({ picked: Array.from({ length: 101 }, (_, i) => i + 1) })));
    await assertSucceeds(setDoc(doc(db, "pickLists", LIST_ID), listData({ picked: Array.from({ length: 100 }, (_, i) => i + 1) })));
    await assertSucceeds(setDoc(doc(db, "pickLists", LIST_ID), listData({ picked: [] })));
  });

  it("blocks changing the team or event of an existing list", async () => {
    await seedList();
    const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
    await assertFails(updateDoc(doc(db, "pickLists", LIST_ID), { eventCode: "OTHER" }));
    await assertFails(updateDoc(doc(db, "pickLists", LIST_ID), { teamId: OTHER_TEAM_ID }));
  });

  it("never lets anyone delete a list", async () => {
    await seedList();
    await assertFails(deleteDoc(doc(testEnv.authenticatedContext(ADMIN_UID).firestore(), "pickLists", LIST_ID)));
    await assertFails(deleteDoc(doc(testEnv.authenticatedContext(STRATEGIST_UID).firestore(), "pickLists", LIST_ID)));
  });

  it("supports the editor's read-modify-write transaction, audit entry included (lib/pick-list/store.ts)", async () => {
    await seedList();
    const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
    const ref = doc(db, "pickLists", LIST_ID);
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const before = (snap.data()?.picked ?? []) as number[];
        tx.set(ref, listData({ picked: [...before, 118] }));
        tx.set(doc(collection(db, "auditLog")), {
          teamId: TEAM_ID,
          uid: STRATEGIST_UID,
          actorName: "Strategist Person",
          action: "edit-pick-list",
          target: { eventCode: EVENT },
          before: { picked: before },
          after: { picked: [...before, 118] },
          createdAt: new Date(),
        });
      })
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "pickLists", LIST_ID));
      expect(snap.data()?.picked).toEqual([254, 971, 118]);
    });
  });

  describe("auditLog for pick-list editors", () => {
    const entry = (over: Record<string, unknown> = {}) => ({
      teamId: TEAM_ID,
      uid: STRATEGIST_UID,
      actorName: "Strategist Person",
      action: "edit-pick-list",
      target: { eventCode: EVENT },
      before: {},
      after: {},
      createdAt: new Date(),
      ...over,
    });

    it("lets a non-admin editor write an edit-pick-list entry as themselves", async () => {
      const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
      await assertSucceeds(addDoc(collection(db, "auditLog"), entry()));
    });

    it("does not let that editor write any other kind of entry", async () => {
      const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
      await assertFails(addDoc(collection(db, "auditLog"), entry({ action: "hard-reset-scout-data" })));
    });

    it("does not let a non-editor write even an edit-pick-list entry", async () => {
      const db = testEnv.authenticatedContext(SCOUT_UID).firestore();
      await assertFails(addDoc(collection(db, "auditLog"), entry({ uid: SCOUT_UID })));
    });

    it("still requires the entry to be written as yourself, and never lets an editor read the log", async () => {
      const db = testEnv.authenticatedContext(STRATEGIST_UID).firestore();
      await assertFails(addDoc(collection(db, "auditLog"), entry({ uid: ADMIN_UID })));
      await assertFails(getDocs(query(collection(db, "auditLog"), where("teamId", "==", TEAM_ID))));
    });
  });
});

describe("P12: concurrent pick-list edits compose (the transaction pattern in lib/pick-list/store.ts)", () => {
  const EDITOR_A = "concurrent-a";
  const EDITOR_B = "concurrent-b";
  const EVENT = "USWACON1";
  const LIST_ID = `${TEAM_ID}_${EVENT}`;

  // Same read -> apply op to the latest list -> write steps as editPickList(), against the real emulator.
  async function edit(uid: string, name: string, op: PickOp) {
    const db = testEnv.authenticatedContext(uid).firestore();
    const ref = doc(db, "pickLists", LIST_ID);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const before = sanitizePicks(snap.exists() ? snap.data().picked : []);
      const after = applyPickOp(before, op);
      tx.set(ref, { teamId: TEAM_ID, eventCode: EVENT, picked: after, updatedBy: uid, updatedByName: name, updatedAt: new Date() });
    });
  }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = { email: "x@example.com", isAdmin: false, isOwner: false, themeId: "team", teamId: TEAM_ID, primaryRole: "lead-strategist", secondaryRoles: [] };
      await setDoc(doc(db, "users", EDITOR_A), { ...base, name: "A" });
      await setDoc(doc(db, "users", EDITOR_B), { ...base, name: "B" });
      await setDoc(doc(db, "pickLists", LIST_ID), { teamId: TEAM_ID, eventCode: EVENT, picked: [254], updatedBy: EDITOR_A, updatedByName: "A", updatedAt: new Date() });
    });
  });

  it("two editors adding different teams at the same moment both land", async () => {
    await Promise.all([edit(EDITOR_A, "A", { type: "place", team: 111, before: null }), edit(EDITOR_B, "B", { type: "place", team: 222, before: null })]);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const picked = (await getDoc(doc(ctx.firestore(), "pickLists", LIST_ID))).data()?.picked as number[];
      expect(picked).toContain(254);
      expect(picked).toContain(111);
      expect(picked).toContain(222);
      expect(new Set(picked).size).toBe(picked.length);
    });
  });

  it("many simultaneous adds from both editors all survive, with no duplicates", async () => {
    const adds = Array.from({ length: 8 }, (_, i) => edit(i % 2 === 0 ? EDITOR_A : EDITOR_B, i % 2 === 0 ? "A" : "B", { type: "place", team: 1000 + i, before: null }));
    await Promise.all(adds);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const picked = (await getDoc(doc(ctx.firestore(), "pickLists", LIST_ID))).data()?.picked as number[];
      expect([...picked].sort((x, y) => x - y)).toEqual([254, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007]);
    });
  });

  it("a removal and an add at the same moment both apply", async () => {
    await Promise.all([edit(EDITOR_A, "A", { type: "remove", team: 254 }), edit(EDITOR_B, "B", { type: "place", team: 333, before: null })]);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const picked = (await getDoc(doc(ctx.firestore(), "pickLists", LIST_ID))).data()?.picked as number[];
      expect(picked).toEqual([333]);
    });
  });
});

describe("P14: changelog/{id}", () => {
  const OUTSIDER_UID = "cl-outsider-1";
  const PUB_ID = "entry-published";
  const DRAFT_ID = "entry-draft";

  const entryData = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    version: "v1.0.0",
    title: "First release",
    date: "2026-11-01",
    summary: "Hello **world**",
    changes: [{ type: "new", text: "A thing" }],
    status: "published",
    pinned: false,
    createdBy: ADMIN_UID,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    publishedAt: new Date("2026-11-01T10:00:00Z"),
    ...over,
  });
  const draftData = (over: Record<string, unknown> = {}) => entryData({ status: "draft", publishedAt: null, title: "Secret draft", ...over });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users", OUTSIDER_UID), { name: "Outsider", email: "o@example.com", teamId: OTHER_TEAM_ID, primaryRole: "match-scout", secondaryRoles: [], isAdmin: true, isOwner: false, themeId: "team" });
      await setDoc(doc(db, "changelog", PUB_ID), entryData());
      await setDoc(doc(db, "changelog", DRAFT_ID), draftData());
    });
  });

  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();

  describe("reads", () => {
    it("lets a member read a published entry", async () => {
      await assertSucceeds(getDoc(doc(asScout(), "changelog", PUB_ID)));
    });

    it("hides drafts from non-admins, but not from admins", async () => {
      await assertFails(getDoc(doc(asScout(), "changelog", DRAFT_ID)));
      await assertSucceeds(getDoc(doc(asAdmin(), "changelog", DRAFT_ID)));
    });

    it("lets a member list published entries — and rejects an unfiltered list (rules aren't filters)", async () => {
      const db = asScout();
      const published = await assertSucceeds(getDocs(query(collection(db, "changelog"), where("teamId", "==", TEAM_ID), where("status", "==", "published"))));
      expect(published.docs.map((d) => d.id)).toEqual([PUB_ID]);
      await assertFails(getDocs(query(collection(db, "changelog"), where("teamId", "==", TEAM_ID))));
      await assertFails(getDocs(collection(db, "changelog")));
    });

    it("lets an admin list everything, drafts included", async () => {
      const snap = await assertSucceeds(getDocs(query(collection(asAdmin(), "changelog"), where("teamId", "==", TEAM_ID))));
      expect(snap.docs.map((d) => d.id).sort()).toEqual([DRAFT_ID, PUB_ID]);
    });

    it("blocks another team's members (even an admin there) and signed-out users", async () => {
      const outsider = testEnv.authenticatedContext(OUTSIDER_UID).firestore();
      await assertFails(getDoc(doc(outsider, "changelog", PUB_ID)));
      await assertFails(getDoc(doc(outsider, "changelog", DRAFT_ID)));
      await assertFails(getDocs(query(collection(outsider, "changelog"), where("teamId", "==", TEAM_ID), where("status", "==", "published"))));
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "changelog", PUB_ID)));
    });
  });

  describe("writes", () => {
    it("lets an admin create a draft and a published entry", async () => {
      await assertSucceeds(setDoc(doc(asAdmin(), "changelog", "new-draft"), draftData()));
      await assertSucceeds(setDoc(doc(asAdmin(), "changelog", "new-pub"), entryData()));
    });

    it("blocks non-admins from creating, editing, or deleting", async () => {
      const db = asScout();
      await assertFails(setDoc(doc(db, "changelog", "x"), entryData({ createdBy: SCOUT_UID })));
      await assertFails(updateDoc(doc(db, "changelog", PUB_ID), { title: "Hacked" }));
      await assertFails(deleteDoc(doc(db, "changelog", PUB_ID)));
    });

    it("blocks another team's admin from writing to or deleting our entries, or creating entries for our team", async () => {
      const outsider = testEnv.authenticatedContext(OUTSIDER_UID).firestore();
      await assertFails(updateDoc(doc(outsider, "changelog", PUB_ID), { title: "Hacked" }));
      await assertFails(deleteDoc(doc(outsider, "changelog", PUB_ID)));
      await assertFails(setDoc(doc(outsider, "changelog", "x"), entryData({ createdBy: OUTSIDER_UID })));
    });

    it("requires createdBy to be the writer and the team to be the writer's own", async () => {
      await assertFails(setDoc(doc(asAdmin(), "changelog", "x"), entryData({ createdBy: OWNER_UID })));
      await assertFails(setDoc(doc(asAdmin(), "changelog", "x"), entryData({ teamId: OTHER_TEAM_ID })));
    });

    it("lets an admin edit, pin, publish, unpublish, and delete", async () => {
      const db = asAdmin();
      await assertSucceeds(updateDoc(doc(db, "changelog", PUB_ID), { title: "Fixed typo", updatedAt: new Date() }));
      await assertSucceeds(updateDoc(doc(db, "changelog", PUB_ID), { pinned: true, updatedAt: new Date() }));
      await assertSucceeds(updateDoc(doc(db, "changelog", DRAFT_ID), { status: "published", publishedAt: new Date(), updatedAt: new Date() }));
      await assertSucceeds(updateDoc(doc(db, "changelog", PUB_ID), { status: "draft", publishedAt: null, updatedAt: new Date() }));
      await assertSucceeds(deleteDoc(doc(db, "changelog", PUB_ID)));
    });

    it("keeps publishedAt fixed while an entry stays published (edits don't re-light the unread dot)", async () => {
      await assertFails(updateDoc(doc(asAdmin(), "changelog", PUB_ID), { title: "Edit", updatedAt: new Date(), publishedAt: new Date("2030-01-01") }));
    });

    it("never lets teamId, createdBy, or createdAt change", async () => {
      const db = asAdmin();
      await assertFails(updateDoc(doc(db, "changelog", PUB_ID), { teamId: OTHER_TEAM_ID }));
      await assertFails(updateDoc(doc(db, "changelog", PUB_ID), { createdBy: OWNER_UID }));
      await assertFails(updateDoc(doc(db, "changelog", PUB_ID), { createdAt: new Date() }));
    });
  });

  describe("shape validation", () => {
    const create = (over: Record<string, unknown>) => setDoc(doc(asAdmin(), "changelog", "shape-test"), entryData(over));

    it("accepts the boundary values", async () => {
      await assertSucceeds(create({ version: "v".repeat(40), title: "t".repeat(120), summary: "s".repeat(1000), changes: Array.from({ length: 40 }, () => ({ type: "new", text: "x" })) }));
    });

    it("rejects over-long or empty text fields", async () => {
      await assertFails(create({ version: "" }));
      await assertFails(create({ version: "v".repeat(41) }));
      await assertFails(create({ title: "" }));
      await assertFails(create({ title: "t".repeat(121) }));
      await assertFails(create({ summary: "s".repeat(1001) }));
    });

    it("rejects a malformed date", async () => {
      for (const date of ["2026-1-1", "Nov 1 2026", "2026-11-01T00:00", "", 20261101]) await assertFails(create({ date }));
    });

    it("requires 1-40 changes in a list", async () => {
      await assertFails(create({ changes: [] }));
      await assertFails(create({ changes: Array.from({ length: 41 }, () => ({ type: "new", text: "x" })) }));
      await assertFails(create({ changes: "a thing" }));
    });

    it("requires a valid status, a bool pinned, and a publishedAt that matches the status", async () => {
      await assertFails(create({ status: "archived" }));
      await assertFails(create({ pinned: "yes" }));
      await assertFails(create({ status: "published", publishedAt: null }));
      await assertFails(create({ status: "draft", publishedAt: new Date() }));
    });

    it("rejects unknown or missing fields", async () => {
      await assertFails(create({ extra: "nope" }));
      const { summary, ...withoutSummary } = entryData();
      void summary;
      await assertFails(setDoc(doc(asAdmin(), "changelog", "shape-test"), withoutSummary));
    });

    it("rejects non-timestamp times", async () => {
      await assertFails(create({ createdAt: "yesterday" }));
      await assertFails(create({ updatedAt: 123 }));
    });
  });

  describe("transactions (lib/changelog/store.ts)", () => {
    it("lets an admin save an edit plus its audit entry in one transaction", async () => {
      const db = asAdmin();
      const ref = doc(db, "changelog", PUB_ID);
      await assertSucceeds(
        runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          tx.set(ref, entryData({ title: "Edited", createdAt: snap.data()?.createdAt, publishedAt: snap.data()?.publishedAt, updatedAt: new Date() }));
          tx.set(doc(collection(db, "auditLog")), { teamId: TEAM_ID, uid: ADMIN_UID, actorName: "Admin Person", action: "edit-changelog-entry", target: { entryId: PUB_ID }, before: null, after: null, createdAt: new Date() });
        })
      );
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        expect((await getDoc(doc(ctx.firestore(), "changelog", PUB_ID))).data()?.title).toBe("Edited");
      });
    });

    it("lets an admin seed the starter drafts and set the team's changelogSeeded flag in one transaction", async () => {
      const db = asAdmin();
      const teamRef = doc(db, "teams", TEAM_ID);
      await assertSucceeds(
        runTransaction(db, async (tx) => {
          const team = await tx.get(teamRef);
          expect(team.data()?.changelogSeeded).toBeUndefined();
          tx.set(doc(db, "changelog", `starter-${TEAM_ID}-v0-1-0`), draftData({ title: "Starter" }));
          tx.update(teamRef, { changelogSeeded: true });
        })
      );
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        expect((await getDoc(doc(ctx.firestore(), "teams", TEAM_ID))).data()?.changelogSeeded).toBe(true);
      });
    });

    it("doesn't let a non-admin flip the seeded flag", async () => {
      await assertFails(updateDoc(doc(asScout(), "teams", TEAM_ID), { changelogSeeded: true }));
    });
  });

  describe("users/{uid}.lastSeenChangelogAt (the unread dot)", () => {
    it("lets any member stamp their own last-seen time", async () => {
      await assertSucceeds(updateDoc(doc(asScout(), "users", SCOUT_UID), { lastSeenChangelogAt: new Date() }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { lastSeenChangelogAt: new Date() }));
    });

    it("doesn't let anyone stamp someone else's", async () => {
      await assertFails(updateDoc(doc(asScout(), "users", ADMIN_UID), { lastSeenChangelogAt: new Date() }));
    });

    it("still can't be used to smuggle in a role change", async () => {
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { lastSeenChangelogAt: new Date(), isAdmin: true }));
    });
  });
});

describe("P14: credits/{teamId}", () => {
  const OUTSIDER_UID = "cr-outsider-1";
  const creditsData = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    sections: [{ id: "team", title: "Team", order: 0, entries: [{ id: "e1", name: "Ada", description: "Lead", link: "https://example.com", imageUrl: null }] }],
    updatedBy: ADMIN_UID,
    updatedByName: "Admin Person",
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OUTSIDER_UID), { name: "Outsider", email: "o@example.com", teamId: OTHER_TEAM_ID, primaryRole: "match-scout", secondaryRoles: [], isAdmin: true, isOwner: false, themeId: "team" });
    });
  });

  const seed = () =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "credits", TEAM_ID), creditsData());
    });
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();

  it("lets any teammate read — including credits that haven't been saved yet", async () => {
    await assertSucceeds(getDoc(doc(asScout(), "credits", TEAM_ID))); // missing doc: must not be denied
    await seed();
    await assertSucceeds(getDoc(doc(asScout(), "credits", TEAM_ID)));
  });

  it("blocks another team's members and signed-out users from reading", async () => {
    await seed();
    await assertFails(getDoc(doc(testEnv.authenticatedContext(OUTSIDER_UID).firestore(), "credits", TEAM_ID)));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "credits", TEAM_ID)));
  });

  it("lets an admin create and then update", async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), "credits", TEAM_ID), creditsData()));
    await assertSucceeds(setDoc(doc(asAdmin(), "credits", TEAM_ID), creditsData({ sections: [] })));
  });

  it("makes it read-only for non-admins", async () => {
    await seed();
    await assertFails(setDoc(doc(asScout(), "credits", TEAM_ID), creditsData({ updatedBy: SCOUT_UID })));
    await assertFails(updateDoc(doc(asScout(), "credits", TEAM_ID), { sections: [] }));
  });

  it("blocks another team's admin", async () => {
    await seed();
    const outsider = testEnv.authenticatedContext(OUTSIDER_UID).firestore();
    await assertFails(setDoc(doc(outsider, "credits", TEAM_ID), creditsData({ updatedBy: OUTSIDER_UID })));
    await assertFails(setDoc(doc(outsider, "credits", TEAM_ID), creditsData({ teamId: OTHER_TEAM_ID, updatedBy: OUTSIDER_UID }))); // can't relabel our doc as theirs
    await assertFails(updateDoc(doc(outsider, "credits", TEAM_ID), { sections: [], updatedBy: OUTSIDER_UID, updatedByName: "Outsider", updatedAt: new Date() }));
  });

  it("requires the doc id to be the writer's team id and teamId to match it", async () => {
    await assertFails(setDoc(doc(asAdmin(), "credits", "some-other-id"), creditsData()));
    await assertFails(setDoc(doc(asAdmin(), "credits", TEAM_ID), creditsData({ teamId: OTHER_TEAM_ID })));
  });

  it("requires updatedBy to be the writer, and sections to be a list of at most 20", async () => {
    await assertFails(setDoc(doc(asAdmin(), "credits", TEAM_ID), creditsData({ updatedBy: OWNER_UID })));
    await assertFails(setDoc(doc(asAdmin(), "credits", TEAM_ID), creditsData({ sections: "none" })));
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: "S", order: i, entries: [] }));
    await assertFails(setDoc(doc(asAdmin(), "credits", TEAM_ID), creditsData({ sections: many(21) })));
    await assertSucceeds(setDoc(doc(asAdmin(), "credits", TEAM_ID), creditsData({ sections: many(20) })));
  });

  it("never lets anyone delete it", async () => {
    await seed();
    await assertFails(deleteDoc(doc(asAdmin(), "credits", TEAM_ID)));
  });

  it("supports the admin's read-modify-write transaction with its audit entry (lib/credits/store.ts)", async () => {
    await seed();
    const db = asAdmin();
    const ref = doc(db, "credits", TEAM_ID);
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const sections = [...(snap.data()?.sections ?? []), { id: "data", title: "Data", order: 1, entries: [] }];
        tx.set(ref, creditsData({ sections }));
        tx.set(doc(collection(db, "auditLog")), { teamId: TEAM_ID, uid: ADMIN_UID, actorName: "Admin Person", action: "edit-credits", target: { op: "add-section" }, before: null, after: null, createdAt: new Date() });
      })
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), "credits", TEAM_ID))).data()?.sections).toHaveLength(2);
    });
  });
});

describe("FIX2: owner can edit roles (own and other admins'), others can't touch an owner", () => {
  const OWNER2_UID = "owner-2";
  const CLAIM_UID = "claim-only-owner";

  const asOwner = () => testEnv.authenticatedContext(OWNER_UID).firestore();
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const withRulesOff = (fn: (db: ReturnType<typeof asOwner>) => Promise<void>) => testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as ReturnType<typeof asOwner>));
  const readUser = async (uid: string) => {
    let data: Record<string, unknown> | undefined;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      data = (await getDoc(doc(ctx.firestore(), "users", uid))).data();
    });
    return data!;
  };

  describe("the sole owner (the reported bug)", () => {
    beforeEach(async () => {
      // Only member: the owner. Everyone else is gone.
      await withRulesOff(async (db) => {
        await deleteDoc(doc(db, "users", ADMIN_UID));
        await deleteDoc(doc(db, "users", SCOUT_UID));
      });
    });

    it("edits their own primary role and secondary roles", async () => {
      await assertSucceeds(updateDoc(doc(asOwner(), "users", OWNER_UID), { primaryRole: "lead-strategist" }));
      await assertSucceeds(updateDoc(doc(asOwner(), "users", OWNER_UID), { secondaryRoles: ["media", "team-coach"] }));
      await assertSucceeds(updateDoc(doc(asOwner(), "users", OWNER_UID), { primaryRole: "drive-team", secondaryRoles: ["pit-scout"], isAdmin: true }));
      expect(await readUser(OWNER_UID)).toMatchObject({ primaryRole: "drive-team", secondaryRoles: ["pit-scout"], isAdmin: true, isOwner: true });
    });

    it("cannot remove their own admin flag, or their owner flag", async () => {
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { isAdmin: false }));
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { isOwner: false }));
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { primaryRole: "media", isAdmin: false })); // not even alongside a role edit
    });

    it("cannot change their team", async () => {
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { teamId: OTHER_TEAM_ID }));
    });

    it("rejects a role id that isn't one of the team's roles", async () => {
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { primaryRole: "supreme-leader" }));
    });

    it("can repair a drifted doc: an admin flag that fell off an owner can be turned back on, never off", async () => {
      await withRulesOff(async (db) => {
        await updateDoc(doc(db, "users", OWNER_UID), { isAdmin: false });
      });
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { primaryRole: "media" })); // would leave isAdmin false
      await assertSucceeds(updateDoc(doc(asOwner(), "users", OWNER_UID), { primaryRole: "media", isAdmin: true }));
    });

    it("still edits their own name and theme as before (the self-update rule)", async () => {
      await assertSucceeds(updateDoc(doc(asOwner(), "users", OWNER_UID), { name: "New Name", themeId: "biobuzz" }));
    });
  });

  describe("the owner editing other members", () => {
    it("edits another admin's roles", async () => {
      await assertSucceeds(updateDoc(doc(asOwner(), "users", ADMIN_UID), { primaryRole: "lead-strategist", secondaryRoles: ["media"] }));
    });

    it("revokes and grants admin for non-owners", async () => {
      await assertSucceeds(updateDoc(doc(asOwner(), "users", ADMIN_UID), { isAdmin: false }));
      await assertSucceeds(updateDoc(doc(asOwner(), "users", SCOUT_UID), { isAdmin: true }));
      expect(await readUser(ADMIN_UID)).toMatchObject({ isAdmin: false });
      expect(await readUser(SCOUT_UID)).toMatchObject({ isAdmin: true });
    });

    it("cannot make anyone an owner", async () => {
      await assertFails(updateDoc(doc(asOwner(), "users", SCOUT_UID), { isOwner: true }));
      await assertFails(updateDoc(doc(asOwner(), "users", ADMIN_UID), { isOwner: true }));
    });

    it("cannot move a member to another team (nobody can remove a member from the team)", async () => {
      await assertFails(updateDoc(doc(asOwner(), "users", SCOUT_UID), { teamId: OTHER_TEAM_ID }));
    });

    it("can't edit a second owner — only that owner can", async () => {
      await withRulesOff(async (db) => {
        await setDoc(doc(db, "users", OWNER2_UID), { name: "Owner Two", email: "o2@example.com", teamId: TEAM_ID, primaryRole: "media", secondaryRoles: [], isAdmin: true, isOwner: true, themeId: "team" });
      });
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER2_UID), { primaryRole: "lead-scout" }));
      await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext(OWNER2_UID).firestore(), "users", OWNER2_UID), { primaryRole: "lead-scout" }));
    });
  });

  describe("an admin who isn't the owner", () => {
    it("cannot edit an owner's roles or admin flag", async () => {
      await assertFails(updateDoc(doc(asAdmin(), "users", OWNER_UID), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(asAdmin(), "users", OWNER_UID), { secondaryRoles: ["media"] }));
      await assertFails(updateDoc(doc(asAdmin(), "users", OWNER_UID), { isAdmin: false }));
      await assertFails(updateDoc(doc(asAdmin(), "users", OWNER_UID), { isAdmin: true })); // even a write that looks like a no-op
    });

    it("cannot make themself or anyone an owner", async () => {
      await assertFails(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { isOwner: true }));
      await assertFails(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { isOwner: true }));
    });

    it("edits other members and themself, and grants/revokes admin for non-owners", async () => {
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { primaryRole: "drive-team", secondaryRoles: ["media"] }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { primaryRole: "team-coach", secondaryRoles: ["pit-scout"] }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { isAdmin: true }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { isAdmin: false }));
    });
  });

  describe("a non-admin", () => {
    it("cannot edit anyone — not the owner, an admin, a peer, or themself", async () => {
      await assertFails(updateDoc(doc(asScout(), "users", OWNER_UID), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(asScout(), "users", ADMIN_UID), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { primaryRole: "lead-scout" }));
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { isAdmin: true }));
    });

    it("cannot write isOwner on anyone, themself included — and neither can the owner", async () => {
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { isOwner: true }));
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { isOwner: false }));
    });
  });

  describe("stale or missing ID-token claims never lock the owner out", () => {
    it("works with no custom claims at all (the doc flag is enough)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID, {}).firestore();
      await assertSucceeds(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "media" }));
      await assertSucceeds(updateDoc(doc(db, "users", ADMIN_UID), { primaryRole: "lead-scout" }));
    });

    it("works when the token's claims are stale and say the opposite", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID, { owner: false, admin: false }).firestore();
      await assertSucceeds(updateDoc(doc(db, "users", OWNER_UID), { secondaryRoles: ["media"] }));
      await assertSucceeds(updateDoc(doc(db, "users", SCOUT_UID), { isAdmin: true }));
    });

    it("no longer treats a token claim as team ownership (P20): neither the old `owner` claim nor `platformOwner` edits anything here", async () => {
      await withRulesOff(async (db) => {
        await setDoc(doc(db, "users", CLAIM_UID), { name: "Claim Owner", email: "c@example.com", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
      });
      for (const claims of [{ owner: true }, { platformOwner: true }]) {
        const db = testEnv.authenticatedContext(CLAIM_UID, claims).firestore();
        await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "media" }));
        await assertFails(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "media" }));
        await assertFails(updateDoc(doc(db, "users", CLAIM_UID), { isOwner: true }));
      }
    });

    it("a claim from another team's owner gives nothing here", async () => {
      await withRulesOff(async (db) => {
        await setDoc(doc(db, "users", "outsider-owner"), { name: "Outsider", email: "x@example.com", teamId: OTHER_TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true, isOwner: true, themeId: "team" });
      });
      const db = testEnv.authenticatedContext("outsider-owner", { owner: true }).firestore();
      await assertFails(updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "media" }));
    });
  });

  describe("last-admin safeguard", () => {
    beforeEach(async () => {
      // ADMIN_UID is the only admin: the owner is gone, so no owner can ever step in.
      await withRulesOff(async (db) => {
        await deleteDoc(doc(db, "users", OWNER_UID));
      });
    });

    it("never blocks a role edit for the final admin", async () => {
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { primaryRole: "lead-strategist", secondaryRoles: ["media", "team-coach"] }));
    });

    it("only blocks removing the final admin's own admin status", async () => {
      await assertFails(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { isAdmin: false }));
      await assertFails(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { primaryRole: "media", isAdmin: false }));
    });

    it("doesn't stop the final admin promoting a successor, whom they can then demote again", async () => {
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { isAdmin: true }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { isAdmin: false }));
    });
  });

  describe("role change + audit entry in one batch (lib/team-members.ts updateMemberAccess)", () => {
    it("lets the owner commit their own role change with its audit entry", async () => {
      const db = asOwner();
      const batch = writeBatch(db);
      batch.update(doc(db, "users", OWNER_UID), { primaryRole: "media", secondaryRoles: ["pit-scout"] });
      batch.set(doc(collection(db, "auditLog")), { teamId: TEAM_ID, uid: OWNER_UID, actorName: "Owner Person", action: "edit-member-roles", target: { targetUid: OWNER_UID }, before: null, after: null, createdAt: new Date() });
      await assertSucceeds(batch.commit());
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const logs = await getDocs(query(collection(ctx.firestore(), "auditLog"), where("action", "==", "edit-member-roles")));
        expect(logs.size).toBe(1);
      });
    });

    it("rejects the whole batch — no orphan audit entry — when an admin targets the owner", async () => {
      const db = asAdmin();
      const batch = writeBatch(db);
      batch.update(doc(db, "users", OWNER_UID), { primaryRole: "media" });
      batch.set(doc(collection(db, "auditLog")), { teamId: TEAM_ID, uid: ADMIN_UID, actorName: "Admin Person", action: "edit-member-roles", target: {}, before: null, after: null, createdAt: new Date() });
      await assertFails(batch.commit());
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        expect((await getDocs(collection(ctx.firestore(), "auditLog"))).size).toBe(0);
        expect((await getDoc(doc(ctx.firestore(), "users", OWNER_UID))).data()?.primaryRole).toBe("lead-scout");
      });
    });
  });
});

describe("P15: libraryMatches and libraryEvents (manual matches, publishing, origin)", () => {
  const MANUAL_EVENT = "MAN-SCRIM";
  const API_EVENT = "USWABON1";
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();

  const alliance = (score: number, penaltyPoints = 0, over: Record<string, unknown> = {}) => ({
    teams: [254, 971],
    score,
    penaltyPoints,
    difficulty: score <= 40 ? "easy" : score <= 79 ? "medium" : "hard",
    ...over,
  });
  const manualMatch = (n: number, over: Record<string, unknown> = {}) => ({
    seasonId: "biobuzz",
    eventCode: MANUAL_EVENT,
    eventName: "Scrimmage",
    matchType: "Qualification",
    matchNumber: n,
    alliances: { red: alliance(100, 6), blue: alliance(60) },
    video: null,
    notes: "",
    origin: "manual",
    published: true,
    needsReview: false,
    createdBy: ADMIN_UID,
    importedAt: "2026-11-05T00:00:00.000Z",
    scoresUpdatedAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    ...over,
  });
  const apiMatch = (n: number, over: Record<string, unknown> = {}) => ({
    seasonId: "biobuzz",
    eventCode: API_EVENT,
    eventName: "Rookie Rumble",
    matchType: "Qualification",
    matchNumber: n,
    alliances: { red: alliance(90), blue: alliance(50) },
    video: null,
    origin: "api",
    published: true,
    importedAt: "2026-11-01T00:00:00.000Z",
    scoresUpdatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  });
  const eventData = (code: string, origin: "api" | "manual", over: Record<string, unknown> = {}) => ({
    eventCode: code,
    eventName: origin === "manual" ? "Scrimmage" : "Rookie Rumble",
    seasonId: "biobuzz",
    origin,
    date: null,
    sourceUrl: null,
    defaultVideoUrl: null,
    createdBy: ADMIN_UID,
    ...over,
  });
  const ref = (db: ReturnType<typeof asAdmin>, id: string) => doc(db, "libraryMatches", id);

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "libraryEvents", MANUAL_EVENT), eventData(MANUAL_EVENT, "manual"));
      await setDoc(doc(db, "libraryEvents", API_EVENT), eventData(API_EVENT, "api"));
      await setDoc(ref(db as never, `${MANUAL_EVENT}_Q1`), manualMatch(1));
      await setDoc(ref(db as never, `${MANUAL_EVENT}_Q2`), manualMatch(2, { published: false, needsReview: true }));
      await setDoc(ref(db as never, `${API_EVENT}_Q1`), apiMatch(1));
      // A pre-P15 doc: no origin, no published, no createdBy.
      const { origin, published, ...legacy } = apiMatch(2);
      void origin;
      void published;
      await setDoc(ref(db as never, `${API_EVENT}_Q2`), legacy);
    });
  });

  describe("reading and publishing", () => {
    it("lets a member read a published match", async () => {
      await assertSucceeds(getDoc(ref(asScout(), `${MANUAL_EVENT}_Q1`)));
      await assertSucceeds(getDoc(ref(asScout(), `${API_EVENT}_Q1`)));
    });

    it("keeps a pre-P15 doc (no `published` field) admin-only until the backfill stamps it — the strict read is what stops an unfiltered query leaking drafts", async () => {
      await assertFails(getDoc(ref(asScout(), `${API_EVENT}_Q2`)));
      await assertSucceeds(getDoc(ref(asAdmin(), `${API_EVENT}_Q2`)));
      await assertSucceeds(updateDoc(ref(asAdmin(), `${API_EVENT}_Q2`), { origin: "api", published: true })); // the backfill
      await assertSucceeds(getDoc(ref(asScout(), `${API_EVENT}_Q2`)));
    });

    it("hides an unpublished match from members, but not from admins", async () => {
      await assertFails(getDoc(ref(asScout(), `${MANUAL_EVENT}_Q2`)));
      await assertSucceeds(getDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q2`)));
    });

    it("lets a member list published matches by event or season — and rejects an unfiltered list (rules aren't filters)", async () => {
      const db = asScout();
      const byEvent = await assertSucceeds(getDocs(query(collection(db, "libraryMatches"), where("eventCode", "==", MANUAL_EVENT), where("published", "==", true))));
      expect(byEvent.docs.map((d) => d.id)).toEqual([`${MANUAL_EVENT}_Q1`]);
      const bySeason = await assertSucceeds(getDocs(query(collection(db, "libraryMatches"), where("seasonId", "==", "biobuzz"), where("published", "==", true))));
      expect(bySeason.docs.map((d) => d.id).sort()).toEqual([`${MANUAL_EVENT}_Q1`, `${API_EVENT}_Q1`]); // the legacy doc has no `published` field until the backfill
      await assertFails(getDocs(query(collection(db, "libraryMatches"), where("eventCode", "==", MANUAL_EVENT))));
      await assertFails(getDocs(collection(db, "libraryMatches")));
      await assertFails(getDocs(query(collection(db, "libraryMatches"), where("published", "==", false))));
    });

    it("lets an admin read everything, drafts included", async () => {
      const snap = await assertSucceeds(getDocs(collection(asAdmin(), "libraryMatches")));
      expect(snap.size).toBe(4);
    });

    it("blocks signed-out users", async () => {
      await assertFails(getDoc(ref(testEnv.unauthenticatedContext().firestore(), `${MANUAL_EVENT}_Q1`)));
    });

    it("lets an admin publish and unpublish a manual match, and attach a video", async () => {
      await assertSucceeds(updateDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q2`), { published: true, needsReview: false, updatedAt: "2026-11-06T00:00:00.000Z" }));
      await assertSucceeds(getDoc(ref(asScout(), `${MANUAL_EVENT}_Q2`)));
      await assertSucceeds(updateDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q2`), { published: false }));
      await assertFails(getDoc(ref(asScout(), `${MANUAL_EVENT}_Q2`)));
      await assertSucceeds(updateDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q1`), { video: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSec: 10, endSec: 160 } }));
    });
  });

  describe("manual matches: who can write and what shape", () => {
    const create = (db: ReturnType<typeof asAdmin>, n: number, over: Record<string, unknown> = {}, id?: string) =>
      setDoc(ref(db, id ?? `${MANUAL_EVENT}_Q${n}`), manualMatch(n, over));

    it("lets an admin create and edit a manual match under a manual event", async () => {
      await assertSucceeds(create(asAdmin(), 3));
      await assertSucceeds(create(asAdmin(), 3, { alliances: { red: alliance(55), blue: alliance(60) }, updatedAt: "2026-11-06T00:00:00.000Z" })); // full replace, as an edit does
    });

    it("blocks non-admins", async () => {
      await assertFails(create(asScout(), 3, { createdBy: SCOUT_UID }));
      await assertFails(updateDoc(ref(asScout(), `${MANUAL_EVENT}_Q1`), { published: false }));
      await assertFails(deleteDoc(ref(asScout(), `${MANUAL_EVENT}_Q1`)));
    });

    it("requires a manual event: not a missing one, and never an API event's code", async () => {
      await assertFails(create(asAdmin(), 3, { eventCode: "MAN-NOPE" }, "MAN-NOPE_Q3"));
      await assertFails(create(asAdmin(), 5, { eventCode: API_EVENT }, `${API_EVENT}_Q5`));
    });

    it("requires the doc id to be the one its own fields give", async () => {
      await assertFails(create(asAdmin(), 3, {}, `${MANUAL_EVENT}_Q99`));
      await assertFails(create(asAdmin(), 3, { matchType: "Practice" }, `${MANUAL_EVENT}_Q3`));
      await assertSucceeds(create(asAdmin(), 3, { matchType: "Practice" }, `${MANUAL_EVENT}_P3`));
      await assertSucceeds(create(asAdmin(), 4, { matchType: "Playoff" }, `${MANUAL_EVENT}_F4`));
    });

    it("validates the alliance numbers: penalty never above score, whole non-negative scores, 2 teams, a real difficulty", async () => {
      await assertFails(create(asAdmin(), 3, { alliances: { red: alliance(10, 11), blue: alliance(60) } }));
      await assertFails(create(asAdmin(), 3, { alliances: { red: alliance(-1), blue: alliance(60) } }));
      await assertFails(create(asAdmin(), 3, { alliances: { red: alliance(10.5), blue: alliance(60) } }));
      await assertFails(create(asAdmin(), 3, { alliances: { red: alliance(10, 0, { teams: [254] }), blue: alliance(60) } }));
      await assertFails(create(asAdmin(), 3, { alliances: { red: alliance(10, 0, { difficulty: "brutal" }), blue: alliance(60) } }));
      await assertFails(create(asAdmin(), 3, { alliances: { red: alliance(10000), blue: alliance(60) } }));
      await assertSucceeds(create(asAdmin(), 3, { alliances: { red: alliance(10, 10), blue: alliance(0) } }));
    });

    it("validates the rest of the shape", async () => {
      await assertFails(create(asAdmin(), 3, { published: "yes" }));
      await assertFails(create(asAdmin(), 3, { matchType: "Scrimmage" }));
      await assertFails(create(asAdmin(), 3, { notes: "x".repeat(501) }));
      await assertFails(create(asAdmin(), 3, { createdBy: 5 }));
      await assertFails(create(asAdmin(), 3, { needsReview: "maybe" }));
    });

    it("accepts a whole event's worth of matches in one batch (the bulk import)", async () => {
      const db = asAdmin();
      const batch = writeBatch(db);
      for (let n = 10; n < 60; n++) batch.set(ref(db, `${MANUAL_EVENT}_Q${n}`), manualMatch(n, { published: false, needsReview: true }));
      await assertSucceeds(batch.commit());
    });

    it("lets an admin delete a manual match — but never an API one", async () => {
      await assertSucceeds(deleteDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q1`)));
      await assertFails(deleteDoc(ref(asAdmin(), `${API_EVENT}_Q1`)));
      await assertFails(deleteDoc(ref(asAdmin(), `${API_EVENT}_Q2`))); // legacy docs are API too
    });
  });

  describe("API and manual data never overwrite each other", () => {
    it("an API refresh (merge-set with origin 'api') can't touch a manual match", async () => {
      await assertFails(setDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q1`), { ...apiMatch(1), eventCode: MANUAL_EVENT }, { merge: true }));
      await assertFails(setDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q1`), { alliances: { red: alliance(1), blue: alliance(1) }, origin: "api" }, { merge: true }));
    });

    it("a manual write can't touch an API match, or a pre-P15 one", async () => {
      await assertFails(setDoc(ref(asAdmin(), `${API_EVENT}_Q1`), manualMatch(1, { eventCode: API_EVENT })));
      await assertFails(setDoc(ref(asAdmin(), `${API_EVENT}_Q2`), manualMatch(2, { eventCode: API_EVENT })));
      await assertFails(updateDoc(ref(asAdmin(), `${API_EVENT}_Q1`), { origin: "manual" }));
    });

    it("origin can't be flipped on an existing match, in either direction", async () => {
      await assertFails(updateDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q1`), { origin: "api" }));
      await assertFails(updateDoc(ref(asAdmin(), `${API_EVENT}_Q1`), { origin: "manual" }));
    });

    it("an API refresh still updates API matches, and the backfill can stamp a pre-P15 doc", async () => {
      await assertSucceeds(setDoc(ref(asAdmin(), `${API_EVENT}_Q1`), { alliances: { red: alliance(95), blue: alliance(50) }, scoresUpdatedAt: "2026-11-06T00:00:00.000Z", origin: "api" }, { merge: true }));
      await assertSucceeds(updateDoc(ref(asAdmin(), `${API_EVENT}_Q2`), { origin: "api", published: true })); // the P15 backfill
      await assertSucceeds(updateDoc(ref(asAdmin(), `${API_EVENT}_Q2`), { video: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSec: 0, endSec: 150 } })); // P3's video edit on a legacy doc
    });

    it("an API match can't be created under a manual event's code", async () => {
      await assertFails(setDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q8`), apiMatch(8, { eventCode: MANUAL_EVENT })));
      await assertSucceeds(setDoc(ref(asAdmin(), `${API_EVENT}_Q8`), apiMatch(8))); // under an API event, fine
      await assertSucceeds(setDoc(ref(asAdmin(), `USNEWEVT_Q1`), apiMatch(1, { eventCode: "USNEWEVT" }))); // an event never seen before
    });

    it("can't move a match to another event", async () => {
      await assertFails(updateDoc(ref(asAdmin(), `${MANUAL_EVENT}_Q1`), { eventCode: "MAN-OTHER" }));
    });
  });

  describe("libraryEvents", () => {
    const ev = (db: ReturnType<typeof asAdmin>, code: string) => doc(db, "libraryEvents", code);

    it("lets any member read events", async () => {
      await assertSucceeds(getDoc(ev(asScout(), MANUAL_EVENT)));
      await assertSucceeds(getDocs(collection(asScout(), "libraryEvents")));
      await assertFails(getDoc(ev(testEnv.unauthenticatedContext().firestore(), MANUAL_EVENT)));
    });

    it("lets an admin create a manual event (and an API event doc on import), but not a non-admin", async () => {
      await assertSucceeds(setDoc(ev(asAdmin(), "MAN-NEW"), eventData("MAN-NEW", "manual", { date: "2026-12-01", sourceUrl: "https://example.com/scores", defaultVideoUrl: "https://youtu.be/dQw4w9WgXcQ" })));
      await assertSucceeds(setDoc(ev(asAdmin(), "USOTHER1"), eventData("USOTHER1", "api")));
      await assertFails(setDoc(ev(asScout(), "MAN-X1"), eventData("MAN-X1", "manual", { createdBy: SCOUT_UID })));
    });

    it("validates a new manual event: id/code match, safe code characters, a name, createdBy is the writer", async () => {
      await assertFails(setDoc(ev(asAdmin(), "MAN-NEW"), eventData("MAN-OTHER", "manual")));
      await assertFails(setDoc(ev(asAdmin(), "man-new"), eventData("man-new", "manual")));
      await assertFails(setDoc(ev(asAdmin(), "MAN_NEW"), eventData("MAN_NEW", "manual")));
      await assertFails(setDoc(ev(asAdmin(), "AB"), eventData("AB", "manual")));
      await assertFails(setDoc(ev(asAdmin(), "MAN-NEW"), eventData("MAN-NEW", "manual", { eventName: "" })));
      await assertFails(setDoc(ev(asAdmin(), "MAN-NEW"), eventData("MAN-NEW", "manual", { createdBy: OWNER_UID })));
      await assertFails(setDoc(ev(asAdmin(), "MAN-NEW"), eventData("MAN-NEW", "forged" as never)));
    });

    it("never lets an API import take over a manual event's code, or the reverse", async () => {
      await assertFails(setDoc(ev(asAdmin(), MANUAL_EVENT), eventData(MANUAL_EVENT, "api")));
      await assertFails(setDoc(ev(asAdmin(), API_EVENT), eventData(API_EVENT, "manual")));
      await assertFails(updateDoc(ev(asAdmin(), MANUAL_EVENT), { origin: "api" }));
    });

    it("lets an admin edit a manual event's details", async () => {
      await assertSucceeds(updateDoc(ev(asAdmin(), MANUAL_EVENT), { eventName: "Renamed", date: "2026-12-02", defaultVideoUrl: "https://youtu.be/dQw4w9WgXcQ" }));
      await assertFails(updateDoc(ev(asScout(), MANUAL_EVENT), { eventName: "Renamed" }));
    });

    it("lets an admin delete a manual event, never an API one, never a non-admin", async () => {
      await assertSucceeds(deleteDoc(ev(asAdmin(), MANUAL_EVENT)));
      await assertFails(deleteDoc(ev(asAdmin(), API_EVENT)));
      await assertFails(deleteDoc(ev(asScout(), API_EVENT)));
    });
  });
});

describe("P15: the documents lib/library really builds are accepted by the rules (end to end)", () => {
  const EVENT = "MAN-FLOW";
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const eventRef = { eventCode: EVENT, eventName: "Flow Event", seasonId: "biobuzz" };
  const NOW = "2026-11-05T12:00:00.000Z";

  // Exactly the fields lib/library/store.ts's createManualEvent writes.
  const eventDoc = (over: Record<string, unknown> = {}) => ({
    eventCode: EVENT,
    eventName: "Flow Event",
    seasonId: "biobuzz",
    origin: "manual",
    date: "2026-11-01",
    sourceUrl: "https://example.com/scores",
    defaultVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    createdBy: ADMIN_UID,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });
  const auditEntry = (target: Record<string, unknown>) => ({ teamId: TEAM_ID, uid: ADMIN_UID, actorName: "Admin Person", action: "edit-match-library", target, before: null, after: null, createdAt: new Date() });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "libraryEvents", EVENT), eventDoc());
    });
  });

  const CSV_HEADER = "matchType,matchNumber,red1,red2,blue1,blue2,redScore,blueScore,redPenalty,bluePenalty,youtubeUrl,startSec,endSec,notes";
  const csvRows = (count: number) =>
    Array.from({ length: count }, (_, i) => `Q,${i + 1},${100 + i},${200 + i},${300 + i},${400 + i},${20 + i * 5},${60 + i * 3},${i % 4},0,https://youtu.be/dQw4w9WgXcQ?si=abc,${i * 10}:00,${i * 10 + 3}:00,row ${i + 1}`).join("\n");

  it("accepts a single manual match built by buildManualMatchDoc, and an edit of it (full replace, keeping its creator and import time)", async () => {
    const parsed = validateRawMatch({ ...emptyRawMatch(), matchNumber: "7", red1: "254", red2: "971", blue1: "118", blue2: "1114", redScore: "142", blueScore: "98", redPenalty: "6", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ?t=70", end: "3:40" });
    expect(parsed.ok).toBe(true);
    const created = buildManualMatchDoc(parsed.match!, eventRef, null, { newPublished: true, newNeedsReview: false }, ADMIN_UID, NOW);
    await assertSucceeds(setDoc(doc(asAdmin(), "libraryMatches", `${EVENT}_Q7`), created));

    const edited = validateRawMatch({ ...emptyRawMatch(), matchNumber: "7", red1: "254", red2: "971", blue1: "118", blue2: "1114", redScore: "30", blueScore: "98", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", end: "3:40" });
    await assertSucceeds(setDoc(doc(asAdmin(), "libraryMatches", `${EVENT}_Q7`), buildManualMatchDoc(edited.match!, eventRef, created, { newPublished: true, newNeedsReview: false }, ADMIN_UID, "2026-11-06T00:00:00.000Z")));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const data = (await getDoc(doc(ctx.firestore(), "libraryMatches", `${EVENT}_Q7`))).data();
      expect(data).toMatchObject({ origin: "manual", published: true, importedAt: NOW, updatedAt: "2026-11-06T00:00:00.000Z" });
      expect(data?.alliances.red.difficulty).toBe("easy"); // 30 → easy: difficulty follows the edited score
    });
  });

  it("runs the whole bulk flow: import 40 rows unpublished (one batch + audit) → members see none → Publish all → members see all", async () => {
    const result = validateBulk({ text: `${CSV_HEADER}\n${csvRows(40)}`, event: eventRef, defaults: { matchType: null, youtubeUrl: "" }, existing: new Map() });
    const summary = summarizeBulk(result);
    expect(summary).toMatchObject({ total: 40, valid: 40, errors: 0, creates: 40 });

    const db = asAdmin();
    const batch = writeBatch(db);
    for (const row of summary.importable) batch.set(doc(db, "libraryMatches", row.id!), buildManualMatchDoc(row.match!, eventRef, null, { newPublished: false, newNeedsReview: true }, ADMIN_UID, NOW));
    batch.set(doc(collection(db, "auditLog")), auditEntry({ op: "upsert-matches", eventCode: EVENT }));
    await assertSucceeds(batch.commit());

    // Members can't see unpublished matches — by query (filtered) or by id; an unfiltered query is rejected.
    const published = query(collection(asScout(), "libraryMatches"), where("eventCode", "==", EVENT), where("published", "==", true));
    expect((await assertSucceeds(getDocs(published))).size).toBe(0);
    await assertFails(getDoc(doc(asScout(), "libraryMatches", `${EVENT}_Q1`)));
    await assertFails(getDocs(query(collection(asScout(), "libraryMatches"), where("eventCode", "==", EVENT))));

    // Admin reads them all, flagged for review.
    const all = await assertSucceeds(getDocs(query(collection(db, "libraryMatches"), where("eventCode", "==", EVENT))));
    expect(all.size).toBe(40);
    expect(all.docs.every((d) => d.data().needsReview === true && d.data().published === false)).toBe(true);

    // Publish all (what setMatchesPublished writes).
    const publish = writeBatch(db);
    for (const d of all.docs) publish.update(d.ref, { published: true, needsReview: false, updatedAt: "2026-11-06T00:00:00.000Z" });
    publish.set(doc(collection(db, "auditLog")), auditEntry({ op: "publish-matches", count: 40 }));
    await assertSucceeds(publish.commit());
    expect((await assertSucceeds(getDocs(published))).size).toBe(40);
  });

  it("accepts the bulk follow-ups: set a video link on many, rename the event (copied onto its matches), unpublish, delete", async () => {
    const parsed = validateRawMatch({ ...emptyRawMatch(), matchNumber: "1", red1: "1", red2: "2", blue1: "3", blue2: "4", redScore: "50", blueScore: "40" });
    await assertSucceeds(setDoc(doc(asAdmin(), "libraryMatches", `${EVENT}_Q1`), buildManualMatchDoc(parsed.match!, eventRef, null, { newPublished: true, newNeedsReview: false }, ADMIN_UID, NOW)));
    const db = asAdmin();
    const m = doc(db, "libraryMatches", `${EVENT}_Q1`);
    await assertSucceeds(updateDoc(m, { video: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSec: 0, endSec: 150 }, updatedAt: NOW }));
    await assertSucceeds(updateDoc(doc(db, "libraryEvents", EVENT), { eventName: "Renamed", date: null, sourceUrl: null, defaultVideoUrl: null, updatedAt: NOW }));
    await assertSucceeds(updateDoc(m, { eventName: "Renamed", updatedAt: NOW }));
    await assertSucceeds(updateDoc(m, { published: false, needsReview: false, updatedAt: NOW }));
    await assertSucceeds(deleteDoc(m));
    await assertSucceeds(deleteDoc(doc(db, "libraryEvents", EVENT)));
  });

  it("accepts the event doc createManualEvent builds, and rejects one that reuses a code an API event holds", async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), "libraryEvents", "MAN-SECOND"), eventDoc({ eventCode: "MAN-SECOND" })));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "libraryEvents", "USWABON1"), eventDoc({ eventCode: "USWABON1", origin: "api" }));
    });
    await assertFails(setDoc(doc(asAdmin(), "libraryEvents", "USWABON1"), eventDoc({ eventCode: "USWABON1" })));
  });

  it("accepts what importLibraryEvent writes (event doc + merge-set matches), twice — and the second run can't touch a manual match", async () => {
    const db = asAdmin();
    await assertSucceeds(setDoc(doc(db, "libraryEvents", "USAPI001"), eventDoc({ eventCode: "USAPI001", eventName: "API Event", origin: "api", date: null, sourceUrl: null, defaultVideoUrl: null })));
    const apiMatch = (score: number) => ({
      seasonId: "biobuzz",
      eventCode: "USAPI001",
      eventName: "API Event",
      matchType: "Qualification",
      matchNumber: 1,
      alliances: { red: { teams: [10, 20], score, penaltyPoints: 4, difficulty: "medium" }, blue: { teams: [30, 40], score: 20, penaltyPoints: 0, difficulty: "easy" } },
      scoresUpdatedAt: NOW,
      origin: "api",
    });
    await assertSucceeds(setDoc(doc(db, "libraryMatches", "USAPI001_Q1"), { ...apiMatch(70), video: null, importedAt: NOW, published: true }, { merge: true })); // first import
    await assertSucceeds(setDoc(doc(db, "libraryMatches", "USAPI001_Q1"), apiMatch(75), { merge: true })); // "refresh scores"
    // The same call against a manual match (as if an API event used a manual event's id) is refused.
    await assertFails(setDoc(doc(db, "libraryMatches", `${EVENT}_Q1`), { ...apiMatch(75), eventCode: EVENT, matchNumber: 1 }, { merge: true }));
  });
});

// FIX3: the rules regression suite for Practice Scouting. It runs the app's ACTUAL queries
// (lib/practice-queries.ts — the same builders the hooks use) and the real id-reservation
// transaction (lib/claim-doc.ts) for each kind of user, so a rule/query mismatch — the
// "Missing or insufficient permissions" on starting practice scouting — can't silently return.
describe("FIX3: practice queries and writes, for every kind of user", () => {
  const PLAIN_UID = "plain-member-1"; // not an admin, primary role media
  const SEASON = "biobuzz";
  const EVENT = "USWABON1";
  const OWN_LOBBY = "LB-OWN001";
  const OTHER_LOBBY = "LB-OTH001";
  const MATCH_KEY = `${EVENT}_Q1`;

  const lib = (n: number, over: Record<string, unknown> = {}) => ({
    seasonId: SEASON,
    eventCode: EVENT,
    eventName: "Rookie Rumble",
    matchType: "Qualification",
    matchNumber: n,
    alliances: { red: { teams: [1, 2], score: 60, penaltyPoints: 0, difficulty: "medium" }, blue: { teams: [3, 4], score: 30, penaltyPoints: 0, difficulty: "easy" } },
    video: null,
    origin: "api",
    published: true,
    importedAt: "2026-11-01T00:00:00.000Z",
    scoresUpdatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  });
  const session = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    uid: SCOUT_UID,
    kind: "solo",
    status: "in-progress",
    startedAt: "2026-11-05T00:00:00.000Z",
    libraryMatchId: `${EVENT}_Q1`,
    alliance: "red",
    ...over,
  });

  const USERS = [
    { label: "the owner", uid: OWNER_UID },
    { label: "a non-admin Match Scout", uid: SCOUT_UID },
    { label: "a plain member", uid: PLAIN_UID },
  ];

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users", PLAIN_UID), { name: "Plain Member", email: "plain@example.com", teamId: TEAM_ID, primaryRole: "media", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
      // Library: two published matches, one unpublished manual draft.
      await setDoc(doc(db, "libraryMatches", `${EVENT}_Q1`), lib(1));
      await setDoc(doc(db, "libraryMatches", `${EVENT}_Q2`), lib(2));
      await setDoc(doc(db, "libraryEvents", EVENT), { eventCode: EVENT, eventName: "Rookie Rumble", seasonId: SEASON, origin: "api", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: ADMIN_UID });
      await setDoc(doc(db, "libraryEvents", "MAN-DRAFT"), { eventCode: "MAN-DRAFT", eventName: "Draft", seasonId: SEASON, origin: "manual", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: ADMIN_UID });
      await setDoc(doc(db, "libraryMatches", "MAN-DRAFT_Q1"), lib(1, { eventCode: "MAN-DRAFT", eventName: "Draft", origin: "manual", published: false, needsReview: true, createdBy: ADMIN_UID, updatedAt: "2026-11-05T00:00:00.000Z", notes: "" }));
      // Sessions by several users in several states (the Fresh / Opened / Scouted badges read all of them).
      await setDoc(doc(db, "practiceSessions", "PS-OPEN01"), session());
      await setDoc(doc(db, "practiceSessions", "PS-DONE01"), session({ uid: ADMIN_UID, status: "completed" }));
      await setDoc(doc(db, "practiceSessions", "PS-PAUSE1"), session({ uid: PLAIN_UID, status: "paused" }));
      await setDoc(doc(db, "practiceSessions", "PS-LIVE01"), session({ uid: PLAIN_UID, kind: "live", status: "completed" }));
      await setDoc(doc(db, "practiceSessions", "PS-LOBBY1"), session({ uid: ADMIN_UID, kind: "lobby", lobbyId: OWN_LOBBY }));
      // Live presence: our team's scout on a match.
      await setDoc(doc(db, "liveMatches", MATCH_KEY, "scouts", ADMIN_UID), { uid: ADMIN_UID, teamId: TEAM_ID, name: "Admin Person", robot: 1, alliance: "red", sessionId: "PS-LIVE01", lastSeen: new Date() });
      // Lobbies: ours (host admin, two players) and one belonging to another team.
      await setDoc(doc(db, "lobbies", OWN_LOBBY), { teamId: TEAM_ID, hostUid: ADMIN_UID, hostName: "Admin Person", seasonId: SEASON, mode: "trial", status: "waiting", libraryMatchId: null, settings: { hostScouts: true, hostIsDisplayer: false }, pairing: null, startsAt: null, hostLastSeen: new Date(), createdAt: new Date(), resolvedAt: null });
      await setDoc(doc(db, "lobbies", OWN_LOBBY, "players", ADMIN_UID), { uid: ADMIN_UID, teamId: TEAM_ID, name: "Admin Person", lastSeen: new Date(), submitted: false, joinedAt: new Date() });
      await setDoc(doc(db, "lobbies", OWN_LOBBY, "players", SCOUT_UID), { uid: SCOUT_UID, teamId: TEAM_ID, name: "Scout Person", lastSeen: new Date(), submitted: false, joinedAt: new Date() });
      await setDoc(doc(db, "lobbies", OTHER_LOBBY), { teamId: OTHER_TEAM_ID, hostUid: "someone-else", hostName: "X", seasonId: SEASON, mode: "trial", status: "waiting", libraryMatchId: null, settings: { hostScouts: true, hostIsDisplayer: false }, pairing: null, startsAt: null, hostLastSeen: new Date(), createdAt: new Date(), resolvedAt: null });
      await setDoc(doc(db, "lobbies", OTHER_LOBBY, "players", "someone-else"), { uid: "someone-else", teamId: OTHER_TEAM_ID, name: "X", lastSeen: new Date(), submitted: false, joinedAt: new Date() });
    });
  });

  describe.each(USERS)("$label", ({ uid }) => {
    const dbFor = () => testEnv.authenticatedContext(uid).firestore();

    it("loads the library: by season, by event, and everything — published matches only", async () => {
      const bySeason = await assertSucceeds(getDocs(librarySeasonQuery(dbFor() as never, SEASON)));
      expect(bySeason.docs.map((d) => d.id).sort()).toEqual([`${EVENT}_Q1`, `${EVENT}_Q2`]); // the unpublished draft never shows up
      const byEvent = await assertSucceeds(getDocs(libraryEventQuery(dbFor() as never, EVENT, false)));
      expect(byEvent.size).toBe(2);
      const all = await assertSucceeds(getDocs(libraryAllQuery(dbFor() as never, false)));
      expect(all.size).toBe(2);
    });

    it("loads library events and a single match by id", async () => {
      await assertSucceeds(getDocs(collection(dbFor(), "libraryEvents")));
      await assertSucceeds(getDoc(doc(dbFor(), "libraryMatches", `${EVENT}_Q1`)));
    });

    it("loads every session query behind Match Select, the Fresh/Opened/Scouted badges, and the Resume banner", async () => {
      const db = dbFor() as never;
      expect((await assertSucceeds(getDocs(teamSoloSessionsQuery(db, TEAM_ID)))).size).toBeGreaterThan(0); // other users' sessions included
      await assertSucceeds(getDocs(teamLiveSessionsQuery(db, TEAM_ID)));
      await assertSucceeds(getDocs(teamSessionsQuery(db, TEAM_ID)));
      await assertSucceeds(getDocs(ownPausedSessionQuery(db, TEAM_ID, uid)));
      await assertSucceeds(getDocs(completedAttemptQuery(db, TEAM_ID, uid, `${EVENT}_Q1`, "red")));
      await assertSucceeds(getDocs(lobbySessionsQuery(db, TEAM_ID, OWN_LOBBY)));
      await assertSucceeds(getDoc(doc(dbFor(), "practiceSessions", "PS-OPEN01"))); // the session screen's own subscription
    });

    it("reserves a Session ID: reads an id that doesn't exist yet, then creates it (what picking a match does)", async () => {
      const db = dbFor() as never;
      const created = await assertSucceeds(tryClaimDoc(db, "practiceSessions", "PS-NEW001", { teamId: TEAM_ID, uid, kind: "solo", status: "in-progress", startedAt: "2026-11-06T00:00:00.000Z", createdAt: new Date() }));
      expect(created).toBe(true);
      // A second attempt at the same id finds it taken (and the claimer may read their own session).
      expect(await assertSucceeds(tryClaimDoc(db, "practiceSessions", "PS-NEW001", { teamId: TEAM_ID, uid, kind: "solo", status: "in-progress", startedAt: "x", createdAt: new Date() }))).toBe(false);
    });

    it("can't reserve a Session ID for someone else or another team", async () => {
      const db = dbFor() as never;
      await assertFails(tryClaimDoc(db, "practiceSessions", "PS-BAD001", { teamId: TEAM_ID, uid: "someone-else", kind: "solo", status: "in-progress", startedAt: "x", createdAt: new Date() }));
      await assertFails(tryClaimDoc(db, "practiceSessions", "PS-BAD002", { teamId: OTHER_TEAM_ID, uid, kind: "solo", status: "in-progress", startedAt: "x", createdAt: new Date() }));
    });

    it("can't read an existing session that belongs to another team", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-OTHER1"), session({ teamId: OTHER_TEAM_ID, uid: "someone-else" }));
      });
      await assertFails(getDoc(doc(dbFor(), "practiceSessions", "PS-OTHER1")));
      await assertFails(tryClaimDoc(dbFor() as never, "practiceSessions", "PS-OTHER1", { teamId: TEAM_ID, uid, kind: "solo", status: "in-progress", startedAt: "x", createdAt: new Date() }));
    });

    it("loads live presence: one match's scouts, and the team-wide list (collection group)", async () => {
      const db = dbFor() as never;
      const one = await assertSucceeds(getDocs(liveMatchScoutsQuery(db, MATCH_KEY, TEAM_ID)));
      expect(one.size).toBe(1);
      const team = await assertSucceeds(getDocs(teamLiveScoutsQuery(db, TEAM_ID)));
      expect(team.size).toBe(1);
    });

    it("never sees another team's live presence", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "liveMatches", MATCH_KEY, "scouts", "someone-else"), { uid: "someone-else", teamId: OTHER_TEAM_ID, name: "X", robot: 9, alliance: "blue", sessionId: "PS-X", lastSeen: new Date() });
      });
      const db = dbFor() as never;
      expect((await assertSucceeds(getDocs(liveMatchScoutsQuery(db, MATCH_KEY, TEAM_ID)))).docs.map((d) => d.id)).toEqual([ADMIN_UID]);
      await assertFails(getDocs(liveMatchScoutsQuery(db, MATCH_KEY, OTHER_TEAM_ID)));
      await assertFails(getDocs(teamLiveScoutsQuery(db, OTHER_TEAM_ID)));
      await assertFails(getDocs(collection(dbFor(), "liveMatches", MATCH_KEY, "scouts"))); // unfiltered: rules aren't filters
    });

    it("starts watching a live match (writes, then removes, its own presence) but not someone else's", async () => {
      const db = dbFor();
      await assertSucceeds(setDoc(doc(db, "liveMatches", MATCH_KEY, "scouts", uid), { uid, teamId: TEAM_ID, name: "Me", robot: 2, alliance: "red", sessionId: "PS-OPEN01", lastSeen: new Date() }));
      await assertSucceeds(deleteDoc(doc(db, "liveMatches", MATCH_KEY, "scouts", uid)));
      await assertFails(setDoc(doc(db, "liveMatches", MATCH_KEY, "scouts", ADMIN_UID), { uid: ADMIN_UID, teamId: TEAM_ID, name: "Fake", robot: 2, alliance: "red", sessionId: "x", lastSeen: new Date() }));
    });

    it("creates a lobby (reserves the code, then reads it), joins one, and reads its roster and sessions", async () => {
      const db = dbFor();
      expect(await assertSucceeds(tryClaimDoc(db as never, "lobbies", "LB-NEW001", { teamId: TEAM_ID, hostUid: uid, hostName: "Me", seasonId: SEASON, mode: "trial", status: "waiting", libraryMatchId: null, settings: { hostScouts: true, hostIsDisplayer: false }, pairing: null, startsAt: null, hostLastSeen: new Date(), createdAt: new Date(), resolvedAt: null }))).toBe(true);
      await assertSucceeds(getDoc(doc(db, "lobbies", OWN_LOBBY))); // "Join with code" looks the lobby up first
      await assertSucceeds(setDoc(doc(db, "lobbies", OWN_LOBBY, "players", uid), { uid, teamId: TEAM_ID, name: "Me", lastSeen: new Date(), submitted: false, joinedAt: new Date() }, { merge: true }));
      const roster = await assertSucceeds(getDocs(lobbyPlayersQuery(db as never, OWN_LOBBY, TEAM_ID)));
      expect(roster.docs.map((d) => d.id).sort()).toEqual([...new Set([ADMIN_UID, SCOUT_UID, uid])].sort());
    });

    it("finds the lobby you're in (collection group by uid) — and only yours", async () => {
      const mine = await assertSucceeds(getDocs(myLobbyPlayersQuery(dbFor() as never, uid)));
      expect(mine.docs.every((d) => d.data().uid === uid)).toBe(true);
      await assertFails(getDocs(myLobbyPlayersQuery(dbFor() as never, "someone-else"))); // not someone else's
    });

    it("can't see another team's lobby", async () => {
      await assertFails(getDoc(doc(dbFor(), "lobbies", OTHER_LOBBY)));
      await assertFails(getDocs(lobbyPlayersQuery(dbFor() as never, OTHER_LOBBY, OTHER_TEAM_ID)));
      await assertFails(getDocs(collection(dbFor(), "lobbies", OWN_LOBBY, "players"))); // unfiltered: rules aren't filters
    });

    it("keeps session writes to the owner: updates and deletes only its own in-progress/paused session", async () => {
      const db = dbFor();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "practiceSessions", "PS-MINE01"), session({ uid, status: "paused" }));
      });
      await assertSucceeds(updateDoc(doc(db, "practiceSessions", "PS-MINE01"), { status: "in-progress" }));
      await assertSucceeds(deleteDoc(doc(db, "practiceSessions", "PS-MINE01")));
      // Someone else's in-progress session (the scout's own PS-OPEN01 would be fine for the scout): only its owner or an admin may update it.
      const theirs = doc(db, "practiceSessions", "PS-PAUSE1"); // the plain member's paused session
      if (uid === PLAIN_UID) await assertSucceeds(updateDoc(theirs, { status: "in-progress" }));
      else if (uid === SCOUT_UID) await assertFails(updateDoc(theirs, { status: "in-progress" }));
      else await assertSucceeds(updateDoc(theirs, { status: "in-progress" })); // the owner is an admin
    });

    it("reads the team's roster and its own team doc (the practice pages' headers)", async () => {
      await assertSucceeds(getDocs(query(collection(dbFor(), "users"), where("teamId", "==", TEAM_ID))));
      await assertSucceeds(getDoc(doc(dbFor(), "teams", TEAM_ID)));
    });
  });

  it("an admin (and only an admin) can also read unpublished matches, which never reach a scout's list", async () => {
    const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();
    expect((await assertSucceeds(getDocs(libraryEventQuery(admin as never, "MAN-DRAFT", true)))).size).toBe(1);
    const owner = testEnv.authenticatedContext(OWNER_UID).firestore();
    expect((await assertSucceeds(getDocs(libraryAllQuery(owner as never, true)))).size).toBe(3);
    const scout = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(getDocs(libraryEventQuery(scout as never, "MAN-DRAFT", true)));
    await assertFails(getDocs(libraryAllQuery(scout as never, true)));
    expect((await assertSucceeds(getDocs(libraryEventQuery(scout as never, "MAN-DRAFT", false)))).size).toBe(0);
  });
});

describe("FIX3: users/{uid}.glassLayerLevel (the layered-glass slider, saved per user)", () => {
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();

  it("lets a member save their own level — the self-update rule already allows fields that aren't roles", async () => {
    await assertSucceeds(updateDoc(doc(asScout(), "users", SCOUT_UID), { glassLayerLevel: 0.7 }));
    await assertSucceeds(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { glassLayerLevel: 1.5 }));
  });

  it("lets the owner save theirs too (an owner's row was once locked — FIX2)", async () => {
    await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext(OWNER_UID).firestore(), "users", OWNER_UID), { glassLayerLevel: 1.2 }));
  });

  it("doesn't let a non-admin set someone else's", async () => {
    await assertFails(updateDoc(doc(asScout(), "users", ADMIN_UID), { glassLayerLevel: 0.5 }));
    await assertFails(updateDoc(doc(asScout(), "users", OWNER_UID), { glassLayerLevel: 0.5 }));
  });

  it("can't be used to smuggle in a role change", async () => {
    await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { glassLayerLevel: 0.7, isAdmin: true }));
    await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { glassLayerLevel: 0.7, primaryRole: "lead-scout" }));
  });
});

describe("P24: users/{uid}.workspaceFormWidth and workspacePhoneSplit (the practice workspace layout, saved per user)", () => {
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();

  it("lets a member save their own layout: the self-update rule already allows fields that aren't roles", async () => {
    await assertSucceeds(updateDoc(doc(asScout(), "users", SCOUT_UID), { workspaceFormWidth: 0.42 }));
    await assertSucceeds(updateDoc(doc(asScout(), "users", SCOUT_UID), { workspacePhoneSplit: 0.55 }));
    await assertSucceeds(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { workspaceFormWidth: 0.3, workspacePhoneSplit: 0.4 }));
    await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext(OWNER_UID).firestore(), "users", OWNER_UID), { workspaceFormWidth: 0.5 }));
  });

  it("doesn't let anyone set someone else's, or smuggle in a role change", async () => {
    await assertFails(updateDoc(doc(asScout(), "users", ADMIN_UID), { workspaceFormWidth: 0.5 }));
    await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { workspaceFormWidth: 0.5, isAdmin: true }));
    await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { workspacePhoneSplit: 0.5, primaryRole: "lead-scout" }));
  });
});

describe("P25: profiles/{uid} and the users/{uid}.avatar mirror", () => {
  const MATE_UID = "mate-1"; // another non-admin teammate
  const OUTSIDER_UID = "p25-outsider-1";
  const asUid = (uid: string) => testEnv.authenticatedContext(uid).firestore();
  const profile = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    displayName: "Scouty",
    bio: "Likes counting.",
    pronouns: "they/them",
    avatar: { type: "preset", value: "bot" },
    visibility: "public",
    updatedAt: serverTimestamp(),
    ...over,
  });
  const seed = async (uid: string, over: Record<string, unknown> = {}) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "profiles", uid), { ...profile(), updatedAt: new Date(), ...over });
    });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users", MATE_UID), { name: "Mate", email: "m@example.com", teamId: TEAM_ID, primaryRole: "pit-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
      await setDoc(doc(db, "users", OUTSIDER_UID), { name: "Out", email: "o@example.com", teamId: OTHER_TEAM_ID, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
    });
  });

  describe("reading", () => {
    it("a public profile is readable by teammates, the owner of it and admins — not by another team or signed-out visitors", async () => {
      await seed(SCOUT_UID);
      await assertSucceeds(getDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID)));
      await assertSucceeds(getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID)));
      await assertSucceeds(getDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID)));
      await assertFails(getDoc(doc(asUid(OUTSIDER_UID), "profiles", SCOUT_UID)));
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "profiles", SCOUT_UID)));
    });

    it("a private profile is NOT readable by a non-admin teammate, but always by its owner and by admins (and the account owner)", async () => {
      await seed(SCOUT_UID, { visibility: "private" });
      await assertFails(getDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID)));
      await assertSucceeds(getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID)));
      await assertSucceeds(getDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID)));
      await assertSucceeds(getDoc(doc(asUid(OWNER_UID), "profiles", SCOUT_UID)));
      await assertFails(getDoc(doc(asUid(OUTSIDER_UID), "profiles", SCOUT_UID)));
    });

    it("an admin's (or the owner's) profile is always readable by teammates, even when their saved preference is private", async () => {
      await seed(ADMIN_UID, { visibility: "private" });
      await seed(OWNER_UID, { visibility: "private" });
      await assertSucceeds(getDoc(doc(asUid(MATE_UID), "profiles", ADMIN_UID)));
      await assertSucceeds(getDoc(doc(asUid(MATE_UID), "profiles", OWNER_UID)));
    });

    it("promotion applies at once; demotion brings the saved preference back (nothing is rewritten)", async () => {
      await seed(SCOUT_UID, { visibility: "private" });
      await assertFails(getDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID)));
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { isAdmin: true });
      });
      await assertSucceeds(getDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID)));
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { isAdmin: false });
      });
      await assertFails(getDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID)));
    });

    it("a teammate can ask whether a profile exists yet (no denied error), and a member can read their own missing one; another team can't", async () => {
      const snap = await assertSucceeds(getDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID)));
      expect(snap.exists()).toBe(false);
      await assertSucceeds(getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID)));
      await assertFails(getDoc(doc(asUid(OUTSIDER_UID), "profiles", SCOUT_UID)));
    });

    it("can't be listed", async () => {
      await seed(SCOUT_UID);
      await assertFails(getDocs(collection(asUid(MATE_UID), "profiles")));
      await assertFails(getDocs(query(collection(asUid(ADMIN_UID), "profiles"), where("teamId", "==", TEAM_ID))));
    });
  });

  describe("writing your own", () => {
    it("a member creates and edits their own profile", async () => {
      await assertSucceeds(setDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), profile()));
      await assertSucceeds(updateDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), { bio: "New bio", visibility: "private", updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), { avatar: { type: "initials", value: "" }, updatedAt: serverTimestamp() }));
    });

    it("nobody writes someone else's profile — not a teammate, not an admin, not the owner, not another team", async () => {
      await assertFails(setDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID), profile()));
      await assertFails(setDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID), profile()));
      await assertFails(setDoc(doc(asUid(OWNER_UID), "profiles", SCOUT_UID), profile()));
      await seed(SCOUT_UID);
      await assertFails(updateDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID), { bio: "hi", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID), { bio: "Written by an admin", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(asUid(OWNER_UID), "profiles", SCOUT_UID), { pronouns: "he/him", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(asUid(OUTSIDER_UID), "profiles", SCOUT_UID), { bio: "", updatedAt: serverTimestamp() }));
    });

    it("can't be moved to another team, deleted, or carry extra fields", async () => {
      await assertFails(setDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), profile({ teamId: OTHER_TEAM_ID })));
      await assertFails(setDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), profile({ isAdmin: true })));
      await seed(SCOUT_UID);
      await assertFails(updateDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), { teamId: OTHER_TEAM_ID, updatedAt: serverTimestamp() }));
      await assertFails(deleteDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID)));
      await assertFails(deleteDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID)));
    });

    it("validates the fields: bio 280, pronouns 30, display name 40, visibility, a server timestamp", async () => {
      const own = () => doc(asUid(SCOUT_UID), "profiles", SCOUT_UID);
      await assertSucceeds(setDoc(own(), profile({ bio: "x".repeat(280), pronouns: "x".repeat(30), displayName: "x".repeat(40) })));
      await assertFails(setDoc(own(), profile({ bio: "x".repeat(281) })));
      await assertFails(setDoc(own(), profile({ pronouns: "x".repeat(31) })));
      await assertFails(setDoc(own(), profile({ displayName: "x".repeat(41) })));
      await assertFails(setDoc(own(), profile({ bio: 5 })));
      await assertFails(setDoc(own(), profile({ visibility: "friends" })));
      await assertFails(setDoc(own(), profile({ updatedAt: new Date("2020-01-01") })));
    });

    it("validates the avatar: google must be an https googleusercontent URL, presets an id, nothing else", async () => {
      const own = () => doc(asUid(SCOUT_UID), "profiles", SCOUT_UID);
      await assertSucceeds(setDoc(own(), profile({ avatar: { type: "google", value: "https://lh3.googleusercontent.com/a/abc=s96-c" } })));
      await assertSucceeds(setDoc(own(), profile({ avatar: { type: "initials", value: "" } })));
      await assertFails(setDoc(own(), profile({ avatar: { type: "google", value: "https://evil.example.com/x.png" } })));
      await assertFails(setDoc(own(), profile({ avatar: { type: "google", value: "http://lh3.googleusercontent.com/a/abc" } })));
      await assertFails(setDoc(own(), profile({ avatar: { type: "google", value: "https://lh3.googleusercontent.com.evil.com/a" } })));
      await assertFails(setDoc(own(), profile({ avatar: { type: "preset", value: "Not A Preset!" } })));
      await assertFails(setDoc(own(), profile({ avatar: { type: "upload", value: "x" } })));
      await assertFails(setDoc(own(), profile({ avatar: { type: "preset", value: "bot", extra: 1 } })));
      await assertFails(setDoc(own(), profile({ avatar: "bot" })));
    });
  });

  describe("admins are always public", () => {
    it("an admin can't switch their profile to private, on create or later; a non-admin can", async () => {
      await assertFails(setDoc(doc(asUid(ADMIN_UID), "profiles", ADMIN_UID), profile({ visibility: "private" })));
      await assertSucceeds(setDoc(doc(asUid(ADMIN_UID), "profiles", ADMIN_UID), profile({ visibility: "public" })));
      await assertFails(updateDoc(doc(asUid(ADMIN_UID), "profiles", ADMIN_UID), { visibility: "private", updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(doc(asUid(ADMIN_UID), "profiles", ADMIN_UID), { bio: "Still editable", updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(doc(asUid(ADMIN_UID), "profiles", ADMIN_UID), { visibility: "public", updatedAt: serverTimestamp() }));
      await assertSucceeds(setDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), profile({ visibility: "private" })));
    });

    it("the owner is held to the same rule", async () => {
      await assertFails(setDoc(doc(asUid(OWNER_UID), "profiles", OWNER_UID), profile({ visibility: "private" })));
      await assertSucceeds(setDoc(doc(asUid(OWNER_UID), "profiles", OWNER_UID), profile()));
    });

    it("an admin whose saved preference is private (set before promotion) keeps it while an admin: the toggle can't be changed, other edits can", async () => {
      await seed(SCOUT_UID, { visibility: "private" });
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { isAdmin: true });
      });
      await assertFails(updateDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), { visibility: "public", updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID), { bio: "Edited as an admin", updatedAt: serverTimestamp() }));
      expect((await getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID))).data()?.visibility).toBe("private");
    });
  });

  describe("moderation: admins can only clear a teammate's bio and pronouns", () => {
    it("an admin clears both (or one), and nothing else changes", async () => {
      await seed(SCOUT_UID);
      await assertSucceeds(updateDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
      const d = (await getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID))).data()!;
      expect(d.bio).toBe("");
      expect(d.pronouns).toBe("");
      expect(d.displayName).toBe("Scouty");
      expect(d.visibility).toBe("public");
    });

    it("a private profile can be cleared too (admins can read it)", async () => {
      await seed(SCOUT_UID, { visibility: "private" });
      await assertSucceeds(updateDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
    });

    it("an admin can't write text, or change anything but bio / pronouns", async () => {
      await seed(SCOUT_UID);
      const ref = () => doc(asUid(ADMIN_UID), "profiles", SCOUT_UID);
      await assertFails(updateDoc(ref(), { bio: "Replacement text", pronouns: "", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(), { bio: "", pronouns: "she/her", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(), { bio: "", pronouns: "", displayName: "", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(), { bio: "", pronouns: "", visibility: "private", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(), { bio: "", pronouns: "", avatar: { type: "initials", value: "" }, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(), { bio: "", pronouns: "" })); // no fresh timestamp
    });

    it("a non-admin teammate can't clear anyone's", async () => {
      await seed(SCOUT_UID);
      await assertFails(updateDoc(doc(asUid(MATE_UID), "profiles", SCOUT_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
    });

    it("an admin can't clear the owner's — only the owner edits that row", async () => {
      await seed(OWNER_UID);
      await assertFails(updateDoc(doc(asUid(ADMIN_UID), "profiles", OWNER_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(doc(asUid(OWNER_UID), "profiles", OWNER_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
    });

    it("the owner (an admin too) can clear a teammate's, and an admin can clear another (non-owner) admin's", async () => {
      await seed(SCOUT_UID);
      await assertSucceeds(updateDoc(doc(asUid(OWNER_UID), "profiles", SCOUT_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
      await seed(ADMIN_UID);
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "users", "admin-2"), { name: "A2", email: "a2@example.com", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true, isOwner: false, themeId: "team" });
      });
      await assertSucceeds(updateDoc(doc(asUid("admin-2"), "profiles", ADMIN_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
    });

    it("a clear and its audit entry commit together in one batch, as lib/profile/service.ts writes them", async () => {
      await seed(SCOUT_UID);
      const db = asUid(ADMIN_UID);
      const batch = writeBatch(db);
      batch.update(doc(db, "profiles", SCOUT_UID), { bio: "", pronouns: "", updatedAt: serverTimestamp() });
      batch.set(doc(collection(db, "auditLog")), { teamId: TEAM_ID, uid: ADMIN_UID, actorName: "Admin Person", action: "clear-profile-text", target: { targetUid: SCOUT_UID, targetName: "Scout Person" }, before: { bio: "Likes counting.", pronouns: "they/them" }, after: { bio: "", pronouns: "" }, createdAt: serverTimestamp() });
      await assertSucceeds(batch.commit());
    });
  });

  describe("users/{uid}.avatar (the teammate-readable mirror)", () => {
    it("a member saves a valid avatar on their own user doc", async () => {
      await assertSucceeds(updateDoc(doc(asUid(SCOUT_UID), "users", SCOUT_UID), { avatar: { type: "preset", value: "rocket" } }));
      await assertSucceeds(updateDoc(doc(asUid(SCOUT_UID), "users", SCOUT_UID), { avatar: { type: "google", value: "https://lh3.googleusercontent.com/a/x=s96-c" } }));
      await assertSucceeds(updateDoc(doc(asUid(SCOUT_UID), "users", SCOUT_UID), { avatar: { type: "initials", value: "" } }));
    });

    it("rejects an arbitrary URL, an upload type and extra keys", async () => {
      const ref = () => doc(asUid(SCOUT_UID), "users", SCOUT_UID);
      await assertFails(updateDoc(ref(), { avatar: { type: "google", value: "https://evil.example.com/a.png" } }));
      await assertFails(updateDoc(ref(), { avatar: { type: "upload", value: "x" } }));
      await assertFails(updateDoc(ref(), { avatar: { type: "preset", value: "bot", url: "https://x" } }));
    });

    it("teammates read it (the private card shows it), but nobody — admins included — sets someone else's", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { avatar: { type: "preset", value: "bot" } });
      });
      const snap = await assertSucceeds(getDoc(doc(asUid(MATE_UID), "users", SCOUT_UID)));
      expect(snap.data()?.avatar).toEqual({ type: "preset", value: "bot" });
      await assertFails(updateDoc(doc(asUid(MATE_UID), "users", SCOUT_UID), { avatar: { type: "preset", value: "gear" } }));
      await assertFails(updateDoc(doc(asUid(ADMIN_UID), "users", SCOUT_UID), { avatar: { type: "preset", value: "gear" } }));
      await assertFails(updateDoc(doc(asUid(OWNER_UID), "users", SCOUT_UID), { avatar: { type: "preset", value: "gear" }, primaryRole: "match-scout" }));
    });

    it("an admin's role edit still works and leaves the avatar alone", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { avatar: { type: "preset", value: "bot" } });
      });
      await assertSucceeds(updateDoc(doc(asUid(ADMIN_UID), "users", SCOUT_UID), { primaryRole: "pit-scout" }));
    });
  });
});

// P26: page access. The page-access doc, the access requests, and the writes that follow a page's access (assignments and
// attendance: the Assignments page; scout targets: Scout Status). Reads of those collections stay open to the team.
describe("P26: page access in the rules", () => {
  const LEAD = "p26-lead"; // primary Lead Scout
  const SECOND_LEAD = "p26-second-lead"; // match-scout with a SECONDARY Lead Scout role
  const COACH = "p26-coach"; // Team Coach
  const MEDIA = "p26-media"; // Media
  const OUTSIDER = "p26-outsider"; // another team's admin
  const EVENT = "USWABON1";
  const asUid = (uid: string) => testEnv.authenticatedContext(uid).firestore();
  const settings = () => doc(asUid(ADMIN_UID), "teams", TEAM_ID, "settings", "pageAccess");

  const version = { id: "v1", createdAt: "2026-01-01T00:00:00.000Z", slots: [] };
  const assignments = () => ({ teamId: TEAM_ID, eventCode: EVENT, current: version, previous: null });
  const attendance = () => ({ teamId: TEAM_ID, eventCode: EVENT, uids: [SCOUT_UID] });
  const targets = (uid: string) => ({ teamId: TEAM_ID, eventCode: EVENT, ranges: { qualification: "1-10" }, maxOverrides: {}, individual: {}, extraScouts: [], updatedBy: uid, updatedAt: new Date() });

  // The page-access doc as the app writes it (lib/page-access/store.tsx pageAccessDocData), from a list of [page, roles] and overrides.
  const pageAccessData = (pageRoles: Record<string, string[]>, memberOverrides: Record<string, { grant: string[]; deny: string[] }> = {}, uid = ADMIN_UID) => ({
    roleGrants: {},
    pageRoles,
    memberOverrides,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
  const DEFAULT_ROLES = { assignments: ["lead-scout"], "scout-status": ["lead-scout", "team-coach"] };
  const seedDoc = (pageRoles: Record<string, string[]>, memberOverrides: Record<string, { grant: string[]; deny: string[] }> = {}) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "teams", TEAM_ID, "settings", "pageAccess"), { ...pageAccessData(pageRoles, memberOverrides), updatedAt: new Date() });
    });

  const canWrite = async (uid: string, collectionName: "assignments" | "eventAttendance" | "scoutTargets") => {
    const db = asUid(uid);
    const id = `${TEAM_ID}_${EVENT}`;
    const data = collectionName === "assignments" ? assignments() : collectionName === "eventAttendance" ? attendance() : targets(uid);
    try {
      await setDoc(doc(db, collectionName, id), data);
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = { email: "x@example.com", isAdmin: false, isOwner: false, themeId: "team" };
      await setDoc(doc(db, "users", LEAD), { ...base, name: "Lead", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [] });
      await setDoc(doc(db, "users", SECOND_LEAD), { ...base, name: "Second", teamId: TEAM_ID, primaryRole: "match-scout", secondaryRoles: ["media", "lead-scout"] });
      await setDoc(doc(db, "users", COACH), { ...base, name: "Coach", teamId: TEAM_ID, primaryRole: "team-coach", secondaryRoles: [] });
      await setDoc(doc(db, "users", MEDIA), { ...base, name: "Media", teamId: TEAM_ID, primaryRole: "media", secondaryRoles: [] });
      await setDoc(doc(db, "users", OUTSIDER), { ...base, name: "Out", teamId: OTHER_TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true });
    });
  });

  describe("gated writes with no page-access doc yet (the defaults)", () => {
    it("Assignments and attendance: admins, Lead Scouts (primary or secondary); nobody else", async () => {
      for (const c of ["assignments", "eventAttendance"] as const) {
        expect(await canWrite(ADMIN_UID, c), `admin ${c}`).toBe(true);
        expect(await canWrite(OWNER_UID, c), `owner ${c}`).toBe(true);
        expect(await canWrite(LEAD, c), `lead ${c}`).toBe(true);
        expect(await canWrite(SECOND_LEAD, c), `secondary lead ${c}`).toBe(true);
        expect(await canWrite(COACH, c), `coach ${c}`).toBe(false);
        expect(await canWrite(MEDIA, c), `media ${c}`).toBe(false);
        expect(await canWrite(SCOUT_UID, c), `scout ${c}`).toBe(false);
        expect(await canWrite(OUTSIDER, c), `outsider ${c}`).toBe(false);
      }
    });

    it("Scout Status targets: admins, Lead Scouts and Team Coaches", async () => {
      expect(await canWrite(ADMIN_UID, "scoutTargets")).toBe(true);
      expect(await canWrite(LEAD, "scoutTargets")).toBe(true);
      expect(await canWrite(SECOND_LEAD, "scoutTargets")).toBe(true);
      expect(await canWrite(COACH, "scoutTargets")).toBe(true);
      expect(await canWrite(MEDIA, "scoutTargets")).toBe(false);
      expect(await canWrite(SCOUT_UID, "scoutTargets")).toBe(false);
    });
  });

  describe("gated writes follow the page-access doc", () => {
    it("the same answers once the doc holds the defaults", async () => {
      await seedDoc(DEFAULT_ROLES);
      expect(await canWrite(LEAD, "assignments")).toBe(true);
      expect(await canWrite(COACH, "assignments")).toBe(false);
      expect(await canWrite(COACH, "scoutTargets")).toBe(true);
      expect(await canWrite(SCOUT_UID, "scoutTargets")).toBe(false);
    });

    it("the role matrix: taking a role off a page closes it, giving one a page opens it", async () => {
      await seedDoc({ assignments: ["media"], "scout-status": ["lead-scout"] });
      expect(await canWrite(MEDIA, "assignments")).toBe(true);
      expect(await canWrite(LEAD, "assignments")).toBe(false);
      expect(await canWrite(SECOND_LEAD, "assignments")).toBe(true); // via the secondary Media role
      expect(await canWrite(COACH, "scoutTargets")).toBe(false);
      expect(await canWrite(LEAD, "scoutTargets")).toBe(true);
      expect(await canWrite(ADMIN_UID, "assignments")).toBe(true); // admins always
    });

    it("a page the doc doesn't list falls back to its default roles", async () => {
      await seedDoc({ "scout-status": ["lead-scout", "team-coach"] }); // no `assignments` key
      expect(await canWrite(LEAD, "assignments")).toBe(true);
      expect(await canWrite(MEDIA, "assignments")).toBe(false);
    });

    it("an explicit grant opens a page the roles don't; an explicit deny closes one they do (and never an admin)", async () => {
      await seedDoc(DEFAULT_ROLES, { [MEDIA]: { grant: ["assignments"], deny: [] }, [LEAD]: { grant: [], deny: ["assignments"] }, [ADMIN_UID]: { grant: [], deny: ["assignments"] } });
      expect(await canWrite(MEDIA, "assignments")).toBe(true);
      expect(await canWrite(MEDIA, "scoutTargets")).toBe(false); // only that page
      expect(await canWrite(LEAD, "assignments")).toBe(false);
      expect(await canWrite(LEAD, "scoutTargets")).toBe(true);
      expect(await canWrite(ADMIN_UID, "assignments")).toBe(true);
    });

    it("a deny beats a grant on the same page", async () => {
      await seedDoc(DEFAULT_ROLES, { [LEAD]: { grant: ["assignments"], deny: ["assignments"] } });
      expect(await canWrite(LEAD, "assignments")).toBe(false);
    });

    it("another team's settings never apply: reading is team-scoped too", async () => {
      await seedDoc({ assignments: ["media"] });
      await assertFails(getDoc(doc(asUid(OUTSIDER), "teams", TEAM_ID, "settings", "pageAccess")));
      await assertSucceeds(getDoc(doc(asUid(SCOUT_UID), "teams", TEAM_ID, "settings", "pageAccess")));
    });

    it("reading assignments, attendance and targets stays open to the whole team", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "assignments", `${TEAM_ID}_${EVENT}`), assignments());
        await setDoc(doc(ctx.firestore(), "eventAttendance", `${TEAM_ID}_${EVENT}`), attendance());
      });
      await seedDoc({ assignments: [] });
      await assertSucceeds(getDoc(doc(asUid(MEDIA), "assignments", `${TEAM_ID}_${EVENT}`)));
      await assertSucceeds(getDoc(doc(asUid(MEDIA), "eventAttendance", `${TEAM_ID}_${EVENT}`)));
    });
  });

  describe("the page-access doc", () => {
    it("is written only by admins (and the owner), never by anyone else", async () => {
      await assertSucceeds(setDoc(settings(), pageAccessData(DEFAULT_ROLES)));
      await assertSucceeds(setDoc(doc(asUid(OWNER_UID), "teams", TEAM_ID, "settings", "pageAccess"), pageAccessData(DEFAULT_ROLES, {}, OWNER_UID)));
      for (const uid of [LEAD, COACH, SCOUT_UID, MEDIA]) {
        await assertFails(setDoc(doc(asUid(uid), "teams", TEAM_ID, "settings", "pageAccess"), pageAccessData(DEFAULT_ROLES, {}, uid)));
      }
      await assertFails(setDoc(doc(asUid(OUTSIDER), "teams", TEAM_ID, "settings", "pageAccess"), pageAccessData(DEFAULT_ROLES, {}, OUTSIDER)));
      // a role can't give itself the right by being granted the page that edits it: the doc is admin-only whatever it says
      await seedDoc({ "team-management": ["lead-scout"] }, { [LEAD]: { grant: ["team-management"], deny: [] } });
      await assertFails(updateDoc(doc(asUid(LEAD), "teams", TEAM_ID, "settings", "pageAccess"), { memberOverrides: {}, updatedBy: LEAD, updatedAt: serverTimestamp() }));
    });

    it("is validated: the writer, a server timestamp, the field list, and only the pageAccess doc exists", async () => {
      await assertFails(setDoc(settings(), pageAccessData(DEFAULT_ROLES, {}, SCOUT_UID))); // updatedBy must be the writer
      await assertFails(setDoc(settings(), { ...pageAccessData(DEFAULT_ROLES), updatedAt: new Date("2020-01-01") }));
      await assertFails(setDoc(settings(), { ...pageAccessData(DEFAULT_ROLES), extra: 1 }));
      await assertFails(setDoc(settings(), { ...pageAccessData(DEFAULT_ROLES), pageRoles: ["assignments"] }));
      await assertFails(setDoc(doc(asUid(ADMIN_UID), "teams", TEAM_ID, "settings", "other"), pageAccessData(DEFAULT_ROLES)));
      await assertSucceeds(setDoc(settings(), pageAccessData(DEFAULT_ROLES)));
      await assertFails(deleteDoc(settings()));
    });

    it("an admin's write and its audit entry commit together in one batch, as lib/page-access/store.tsx does", async () => {
      const db = asUid(ADMIN_UID);
      const batch = writeBatch(db);
      batch.set(doc(db, "teams", TEAM_ID, "settings", "pageAccess"), pageAccessData(DEFAULT_ROLES));
      batch.set(doc(collection(db, "auditLog")), { teamId: TEAM_ID, uid: ADMIN_UID, actorName: "Admin Person", action: "edit-page-access", target: {}, before: null, after: null, createdAt: serverTimestamp() });
      await assertSucceeds(batch.commit());
    });
  });

  describe("access requests", () => {
    const request = (uid: string, pageId = "assignments", over: Record<string, unknown> = {}) => ({ teamId: TEAM_ID, uid, name: "Someone", pageId, pageTitle: "Assignments", status: "pending", createdAt: serverTimestamp(), ...over });
    const ref = (db: ReturnType<typeof asUid>, uid: string, pageId = "assignments") => doc(db, "teams", TEAM_ID, "pageAccessRequests", `${uid}_${pageId}`);

    it("a member creates their own pending request for a restricted page", async () => {
      await assertSucceeds(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA)));
    });

    it("not for someone else, not with another id, not already decided, not for an open or admin page, not with extra fields", async () => {
      const db = asUid(MEDIA);
      await assertFails(setDoc(ref(db, SCOUT_UID), request(SCOUT_UID)));
      await assertFails(setDoc(doc(db, "teams", TEAM_ID, "pageAccessRequests", "whatever"), request(MEDIA)));
      await assertFails(setDoc(ref(db, MEDIA), request(MEDIA, "assignments", { status: "approved" })));
      await assertFails(setDoc(ref(db, MEDIA, "dashboard"), request(MEDIA, "dashboard")));
      await assertFails(setDoc(ref(db, MEDIA, "admin-panel"), request(MEDIA, "admin-panel")));
      await assertFails(setDoc(ref(db, MEDIA), request(MEDIA, "assignments", { extra: true })));
      await assertFails(setDoc(doc(asUid(OUTSIDER), "teams", TEAM_ID, "pageAccessRequests", `${OUTSIDER}_assignments`), request(OUTSIDER)));
    });

    it("the requester reads their own; admins read all; another member reads none of anyone else's", async () => {
      await assertSucceeds(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA)));
      await assertSucceeds(getDoc(ref(asUid(MEDIA), MEDIA)));
      await assertSucceeds(getDoc(ref(asUid(ADMIN_UID), MEDIA)));
      await assertFails(getDoc(ref(asUid(SCOUT_UID), MEDIA)));
      await assertSucceeds(getDocs(query(collection(asUid(MEDIA), "teams", TEAM_ID, "pageAccessRequests"), where("uid", "==", MEDIA))));
      await assertSucceeds(getDocs(collection(asUid(ADMIN_UID), "teams", TEAM_ID, "pageAccessRequests")));
      await assertFails(getDocs(collection(asUid(MEDIA), "teams", TEAM_ID, "pageAccessRequests"))); // rules aren't filters
    });

    it("only an admin decides it, and only the status moves", async () => {
      await assertSucceeds(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA)));
      const decide = (db: ReturnType<typeof asUid>, uid: string, status: string, extra: Record<string, unknown> = {}) => updateDoc(ref(db, MEDIA), { status, decidedBy: uid, decidedAt: serverTimestamp(), ...extra });
      await assertFails(decide(asUid(MEDIA), MEDIA, "approved")); // you can't approve yourself
      await assertFails(decide(asUid(LEAD), LEAD, "approved"));
      await assertFails(decide(asUid(ADMIN_UID), ADMIN_UID, "approved", { pageId: "team-management" })); // nothing else may change
      await assertFails(decide(asUid(ADMIN_UID), ADMIN_UID, "pending"));
      await assertFails(decide(asUid(ADMIN_UID), SCOUT_UID, "approved")); // decidedBy must be the admin
      await assertSucceeds(decide(asUid(ADMIN_UID), ADMIN_UID, "approved"));
      await assertFails(decide(asUid(ADMIN_UID), ADMIN_UID, "denied")); // decided once
    });

    it("approving adds the grant and marks the request in one batch; the member then can write", async () => {
      await assertSucceeds(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA)));
      await seedDoc(DEFAULT_ROLES);
      const db = asUid(ADMIN_UID);
      const batch = writeBatch(db);
      batch.update(ref(db, MEDIA), { status: "approved", decidedBy: ADMIN_UID, decidedAt: serverTimestamp() });
      batch.set(doc(db, "teams", TEAM_ID, "settings", "pageAccess"), pageAccessData(DEFAULT_ROLES, { [MEDIA]: { grant: ["assignments"], deny: [] } }));
      await assertSucceeds(batch.commit());
      expect(await canWrite(MEDIA, "assignments")).toBe(true);
    });

    it("after a denial the member can ask again; a pending one can't be re-sent", async () => {
      await assertSucceeds(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA)));
      await assertFails(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA))); // already pending
      await assertSucceeds(updateDoc(ref(asUid(ADMIN_UID), MEDIA), { status: "denied", decidedBy: ADMIN_UID, decidedAt: serverTimestamp() }));
      await assertFails(setDoc(ref(asUid(SCOUT_UID), MEDIA), request(MEDIA))); // not yours to re-send
      await assertSucceeds(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA)));
    });

    it("is never deleted", async () => {
      await assertSucceeds(setDoc(ref(asUid(MEDIA), MEDIA), request(MEDIA)));
      await assertFails(deleteDoc(ref(asUid(MEDIA), MEDIA)));
      await assertFails(deleteDoc(ref(asUid(ADMIN_UID), MEDIA)));
    });
  });
});

// P27: formEntries/{entryId}: the entries of the team's other forms. Create needs the form's page access (P26), update is the writer's own values and notes (or
// an admin), delete is admin-only, every teammate reads.
describe("P27: formEntries", () => {
  const LEAD = "p27-lead";
  const PIT = "p27-pit";
  const STRATEGIST = "p27-strategist";
  const DRIVER = "p27-driver";
  const PIT_TEAM = "p27-pit-team";
  const MEDIA = "p27-media";
  const OUTSIDER = "p27-outsider";
  const asUid = (uid: string) => testEnv.authenticatedContext(uid).firestore();

  const input = (formType: NewFormEntry["formType"], over: Partial<NewFormEntry> = {}): NewFormEntry => ({
    scoutName: "Someone",
    formId: `${formType}-v1`,
    formVersion: 1,
    formType,
    eventCode: "USWABON1",
    values: { notes: "hello" },
    ...over,
  });
  const create = (uid: string, formType: NewFormEntry["formType"], over: Partial<NewFormEntry> = {}, docOver: Record<string, unknown> = {}) =>
    addDoc(collection(asUid(uid), "formEntries"), { ...formEntryDoc(TEAM_ID, uid, input(formType, over)), ...docOver });
  const ok = async (uid: string, formType: NewFormEntry["formType"]) => {
    try {
      await create(uid, formType);
      return true;
    } catch {
      return false;
    }
  };
  const seedEntry = async (uid: string, formType: NewFormEntry["formType"] = "pit-scout"): Promise<string> => {
    let id = "";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = doc(collection(ctx.firestore(), "formEntries"));
      id = ref.id;
      await setDoc(ref, { ...formEntryDoc(TEAM_ID, uid, input(formType), () => new Date()) });
    });
    return id;
  };

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = { email: "x@example.com", isAdmin: false, isOwner: false, themeId: "team" };
      await setDoc(doc(db, "users", LEAD), { ...base, name: "Lead", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [] });
      await setDoc(doc(db, "users", PIT), { ...base, name: "Pit", teamId: TEAM_ID, primaryRole: "pit-scout", secondaryRoles: [] });
      await setDoc(doc(db, "users", STRATEGIST), { ...base, name: "Strategist", teamId: TEAM_ID, primaryRole: "lead-strategist", secondaryRoles: [] });
      await setDoc(doc(db, "users", DRIVER), { ...base, name: "Driver", teamId: TEAM_ID, primaryRole: "drive-team", secondaryRoles: [] });
      await setDoc(doc(db, "users", PIT_TEAM), { ...base, name: "PitTeam", teamId: TEAM_ID, primaryRole: "pit-team", secondaryRoles: [] });
      await setDoc(doc(db, "users", MEDIA), { ...base, name: "Media", teamId: TEAM_ID, primaryRole: "media", secondaryRoles: [] });
      await setDoc(doc(db, "users", OUTSIDER), { ...base, name: "Out", teamId: OTHER_TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true });
    });
  });

  describe("creating follows the form's page access (default roles)", () => {
    const matrix: [NewFormEntry["formType"], string[], string[]][] = [
      ["lead-scout", [LEAD, ADMIN_UID, OWNER_UID], [PIT, STRATEGIST, DRIVER, MEDIA, SCOUT_UID]],
      ["pit-scout", [PIT, ADMIN_UID], [LEAD, STRATEGIST, DRIVER, PIT_TEAM, MEDIA]],
      ["team-strategy", [STRATEGIST, ADMIN_UID], [LEAD, PIT, DRIVER, MEDIA]],
      ["match-strategy", [STRATEGIST, ADMIN_UID], [LEAD, PIT, DRIVER, MEDIA]],
      ["drive-reflection", [DRIVER, ADMIN_UID], [LEAD, PIT, STRATEGIST, MEDIA]],
      ["helper", [PIT, PIT_TEAM, ADMIN_UID], [LEAD, STRATEGIST, DRIVER, MEDIA]],
    ];
    for (const [formType, allowed, refused] of matrix) {
      it(`${formType}: ${allowed.length} may, ${refused.length} may not`, async () => {
        for (const uid of allowed) expect(await ok(uid, formType), `${uid} -> ${formType}`).toBe(true);
        for (const uid of refused) expect(await ok(uid, formType), `${uid} -> ${formType}`).toBe(false);
      });
    }

    it("a custom form is open to any teammate (but not another team's)", async () => {
      expect(await ok(MEDIA, "custom")).toBe(true);
      expect(await ok(SCOUT_UID, "custom")).toBe(true);
      expect(await ok(OUTSIDER, "custom")).toBe(false);
    });

    it("follows the page-access doc: the role matrix, an explicit grant, an explicit deny", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "teams", TEAM_ID, "settings", "pageAccess"), {
          roleGrants: {},
          pageRoles: { "pit-scout-form": ["media"], "lead-scout-form": ["lead-scout"], "helper-form": [] },
          memberOverrides: { [DRIVER]: { grant: ["pit-scout-form"], deny: [] }, [LEAD]: { grant: [], deny: ["lead-scout-form"] }, [PIT_TEAM]: { grant: ["helper-form"], deny: [] } },
          updatedBy: ADMIN_UID,
          updatedAt: new Date(),
        });
      });
      expect(await ok(MEDIA, "pit-scout")).toBe(true); // the matrix gave Media the page
      expect(await ok(PIT, "pit-scout")).toBe(false); // and took it from Pit Scout
      expect(await ok(DRIVER, "pit-scout")).toBe(true); // an explicit grant
      expect(await ok(LEAD, "lead-scout")).toBe(false); // an explicit deny beats the role
      expect(await ok(ADMIN_UID, "pit-scout")).toBe(true); // admins always
      expect(await ok(PIT_TEAM, "helper")).toBe(true);
      expect(await ok(PIT, "helper")).toBe(false);
    });

    it("a form type the doc doesn't list falls back to its default roles", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "teams", TEAM_ID, "settings", "pageAccess"), { roleGrants: {}, pageRoles: { "pit-scout-form": [] }, memberOverrides: {}, updatedBy: ADMIN_UID, updatedAt: new Date() });
      });
      expect(await ok(STRATEGIST, "team-strategy")).toBe(true);
      expect(await ok(PIT, "pit-scout")).toBe(false);
    });
  });

  describe("what a created entry must look like", () => {
    it("is written as yourself, in your team, as a real non-scout-entry type, not already excluded, with server times", async () => {
      await assertSucceeds(create(PIT, "pit-scout"));
      await assertFails(addDoc(collection(asUid(PIT), "formEntries"), formEntryDoc(TEAM_ID, LEAD, input("pit-scout")))); // someone else's uid
      await assertFails(addDoc(collection(asUid(PIT), "formEntries"), formEntryDoc(OTHER_TEAM_ID, PIT, input("pit-scout")))); // another team
      await assertFails(create(PIT, "pit-scout", {}, { formType: "match-scout" })); // match scouting has its own collection
      await assertFails(create(PIT, "pit-scout", {}, { excluded: true }));
      await assertFails(create(PIT, "pit-scout", {}, { createdAt: new Date("2020-01-01") }));
      await assertFails(create(PIT, "pit-scout", {}, { isAdmin: true })); // no extra fields
      await assertFails(create(PIT, "pit-scout", {}, { alliance: "green" }));
      await assertFails(create(PIT, "pit-scout", {}, { formId: "bad id!" }));
      await assertFails(create(PIT, "pit-scout", {}, { values: "nope" }));
      await assertFails(create(PIT, "pit-scout", {}, { stickyNotes: new Array(51).fill({}) }));
    });

    it("carries the optional parts when given: match, alliance, team, the linked plan and its difference count", async () => {
      await assertSucceeds(create(DRIVER, "drive-reflection", { matchKey: "Q12", alliance: "red", linkedEntryId: "plan-1", planDifferences: 2 }));
      await assertSucceeds(create(PIT, "pit-scout", { teamNumber: 3468, matchKey: null, alliance: null }));
      await assertFails(create(PIT, "pit-scout", {}, { teamNumber: -5 }));
      await assertFails(create(PIT, "pit-scout", {}, { teamNumber: "3468" }));
    });
  });

  describe("reading, updating and deleting", () => {
    it("every teammate reads; another team does not; signed-out visitors do not", async () => {
      const id = await seedEntry(PIT);
      await assertSucceeds(getDoc(doc(asUid(MEDIA), "formEntries", id)));
      await assertSucceeds(getDoc(doc(asUid(PIT), "formEntries", id)));
      await assertSucceeds(getDocs(query(collection(asUid(MEDIA), "formEntries"), where("teamId", "==", TEAM_ID))));
      await assertSucceeds(getDocs(query(collection(asUid(MEDIA), "formEntries"), where("teamId", "==", TEAM_ID), where("formId", "==", "pit-scout-v1"))));
      await assertFails(getDoc(doc(asUid(OUTSIDER), "formEntries", id)));
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "formEntries", id)));
    });

    it("the writer may change only their values and notes (a finished photo is attached this way); nothing else", async () => {
      const id = await seedEntry(PIT);
      const ref = (uid: string) => doc(asUid(uid), "formEntries", id);
      await assertSucceeds(updateDoc(ref(PIT), { values: { notes: "edited" }, stickyNotes: [{ id: "1", text: "a", color: "y", createdAt: 1 }], updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(ref(PIT), { "values.photos": arrayUnion({ url: "https://x.public.blob.vercel-storage.com/a.jpg", pathname: "a.jpg", size: 1, contentType: "image/jpeg" }), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(PIT), { formId: "other", updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(PIT), { uid: LEAD, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(PIT), { excluded: true, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(PIT), { flags: [{ id: "x" }], updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(PIT), { values: "nope", updatedAt: serverTimestamp() }));
      // someone else on the team cannot
      await assertFails(updateDoc(ref(LEAD), { values: { notes: "hijack" }, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref(OUTSIDER), { values: { notes: "hijack" }, updatedAt: serverTimestamp() }));
    });

    it("an admin may edit an entry (exclude it, flag it, fix values) but never change who wrote it, its form or its date", async () => {
      const id = await seedEntry(PIT);
      const ref = doc(asUid(ADMIN_UID), "formEntries", id);
      await assertSucceeds(updateDoc(ref, { excluded: true, updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(ref, { flags: [{ id: "f", reason: "Other", addedAt: "now" }], values: { notes: "fixed" }, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref, { uid: LEAD }));
      await assertFails(updateDoc(ref, { formId: "other" }));
      await assertFails(updateDoc(ref, { formType: "helper" }));
      await assertFails(updateDoc(ref, { teamId: OTHER_TEAM_ID }));
      await assertFails(updateDoc(ref, { createdAt: new Date("2020-01-01") }));
      await assertFails(updateDoc(doc(asUid(OUTSIDER), "formEntries", id), { excluded: true }));
    });

    it("P29: editing your own entry logs 'edit-form-entry' as yourself; no other audit action, no one else's name, and you can't read the log", async () => {
      const audit = (uid: string, action: string, over: Record<string, unknown> = {}) =>
        addDoc(collection(asUid(uid), "auditLog"), { teamId: TEAM_ID, uid, actorName: "Scout", action, target: { entryId: "e1", formId: "pit-scout-v1" }, before: {}, after: {}, createdAt: new Date(), ...over });
      await assertSucceeds(audit(PIT, "edit-form-entry"));
      await assertFails(audit(PIT, "hard-reset-scout-data"));
      await assertFails(audit(PIT, "edit-form-entry", { uid: LEAD }));
      await assertFails(audit(PIT, "edit-form-entry", { teamId: OTHER_TEAM_ID }));
      await assertFails(audit(OUTSIDER, "edit-form-entry"));
      const ref = await audit(PIT, "edit-form-entry");
      await assertFails(getDoc(doc(asUid(PIT), "auditLog", ref.id)));
      await assertSucceeds(getDoc(doc(asUid(ADMIN_UID), "auditLog", ref.id)));
    });

    it("only an admin deletes", async () => {
      const id = await seedEntry(PIT);
      await assertFails(deleteDoc(doc(asUid(PIT), "formEntries", id)));
      await assertFails(deleteDoc(doc(asUid(LEAD), "formEntries", id)));
      await assertFails(deleteDoc(doc(asUid(OUTSIDER), "formEntries", id)));
      await assertSucceeds(deleteDoc(doc(asUid(ADMIN_UID), "formEntries", id)));
    });
  });
});

describe("P16: scoutTargets/{teamId}_{eventCode}", () => {
  const LEAD_UID = "lead-scout-1"; // primary role lead-scout
  const SECOND_LEAD_UID = "second-lead-1"; // primary match-scout, SECONDARY lead-scout
  const OUTSIDER_UID = "st-outsider-1"; // another team's admin
  const EVENT = "USWABON1";
  const DOC_ID = `${TEAM_ID}_${EVENT}`;

  const targets = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    eventCode: EVENT,
    ranges: { qualification: "1-10" },
    maxOverrides: { practice: 4 },
    individual: { [SCOUT_UID]: { qualification: 6 } },
    extraScouts: [],
    updatedBy: LEAD_UID,
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = { email: "x@example.com", isAdmin: false, isOwner: false, themeId: "team" };
      await setDoc(doc(db, "users", LEAD_UID), { ...base, name: "Lead Scout", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [] });
      await setDoc(doc(db, "users", SECOND_LEAD_UID), { ...base, name: "Second Lead", teamId: TEAM_ID, primaryRole: "match-scout", secondaryRoles: ["media", "lead-scout"] });
      await setDoc(doc(db, "users", OUTSIDER_UID), { ...base, name: "Outsider", teamId: OTHER_TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true });
    });
  });

  const seed = () =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "scoutTargets", DOC_ID), targets());
    });
  const asLead = () => testEnv.authenticatedContext(LEAD_UID).firestore();

  it("lets every teammate read the setups as a team-scoped query — including when none exist yet", async () => {
    const q = (db: ReturnType<typeof asLead>) => getDocs(query(collection(db, "scoutTargets"), where("teamId", "==", TEAM_ID)));
    expect((await assertSucceeds(q(testEnv.authenticatedContext(SCOUT_UID).firestore()))).size).toBe(0);
    await seed();
    expect((await assertSucceeds(q(testEnv.authenticatedContext(SCOUT_UID).firestore()))).size).toBe(1);
    expect((await assertSucceeds(q(testEnv.authenticatedContext(ADMIN_UID).firestore()))).size).toBe(1);
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(SCOUT_UID).firestore(), "scoutTargets", DOC_ID)));
  });

  it("blocks another team's members, an unfiltered list, and signed-out users from reading", async () => {
    await seed();
    const outsider = testEnv.authenticatedContext(OUTSIDER_UID).firestore();
    await assertFails(getDoc(doc(outsider, "scoutTargets", DOC_ID)));
    await assertFails(getDocs(query(collection(outsider, "scoutTargets"), where("teamId", "==", TEAM_ID))));
    await assertFails(getDocs(collection(testEnv.authenticatedContext(SCOUT_UID).firestore(), "scoutTargets"))); // rules aren't filters
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "scoutTargets", DOC_ID)));
  });

  it("lets an admin create and update the setup", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "scoutTargets", DOC_ID), targets({ updatedBy: ADMIN_UID })));
    await assertSucceeds(setDoc(doc(db, "scoutTargets", DOC_ID), targets({ updatedBy: ADMIN_UID, ranges: { qualification: "2-4, 8" } })));
  });

  it("P30: the optional teams-per-scout targets (Pit Scout, Team Strategy) are accepted as a map, and nothing else is", async () => {
    const teamTargets = { "pit-scout": { all: 8, individual: { [SCOUT_UID]: 3 } }, "team-strategy": { all: 5, individual: {} } };
    await assertSucceeds(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ teamTargets })));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ teamTargets: "lots" })));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ teamTargets: { a: {}, b: {}, c: {} } }))); // more than two form types
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ somethingElse: true })));
    // a scout who isn't a lead still can't write them
    await assertFails(setDoc(doc(testEnv.authenticatedContext(SCOUT_UID).firestore(), "scoutTargets", DOC_ID), targets({ teamTargets, updatedBy: SCOUT_UID })));
  });

  it("lets a Lead Scout (primary role) and a member whose SECONDARY role is Lead Scout edit it", async () => {
    await assertSucceeds(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets()));
    const second = testEnv.authenticatedContext(SECOND_LEAD_UID).firestore();
    await assertSucceeds(setDoc(doc(second, "scoutTargets", DOC_ID), targets({ updatedBy: SECOND_LEAD_UID, extraScouts: [SCOUT_UID] })));
  });

  it("makes it read-only for everyone else — a Match Scout, a plain member, another team's admin", async () => {
    await seed();
    const scout = testEnv.authenticatedContext(SCOUT_UID).firestore();
    await assertFails(setDoc(doc(scout, "scoutTargets", DOC_ID), targets({ updatedBy: SCOUT_UID })));
    await assertFails(updateDoc(doc(scout, "scoutTargets", DOC_ID), { ranges: { qualification: "1" } }));
    await assertFails(setDoc(doc(scout, "scoutTargets", `${TEAM_ID}_NEWEVENT`), targets({ eventCode: "NEWEVENT", updatedBy: SCOUT_UID })));
    await assertFails(setDoc(doc(testEnv.authenticatedContext(OUTSIDER_UID).firestore(), "scoutTargets", DOC_ID), targets({ updatedBy: OUTSIDER_UID })));
  });

  it("requires the doc id to be {teamId}_{eventCode}, and updatedBy to be the writer", async () => {
    await assertFails(setDoc(doc(asLead(), "scoutTargets", `${TEAM_ID}_WRONG`), targets()));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", "arbitrary-id"), targets()));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ updatedBy: ADMIN_UID })));
  });

  it("validates the shape: exact fields, the right types, bounded sizes", async () => {
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ extra: "nope" })));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ ranges: "1-10" })));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ extraScouts: "x" })));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ extraScouts: Array.from({ length: 201 }, (_, i) => `u${i}`) })));
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), targets({ updatedAt: "yesterday" })));
    const { individual, ...withoutIndividual } = targets();
    void individual;
    await assertFails(setDoc(doc(asLead(), "scoutTargets", DOC_ID), withoutIndividual));
  });

  it("blocks changing the team or event of an existing setup, and never lets anyone delete one", async () => {
    await seed();
    await assertFails(updateDoc(doc(asLead(), "scoutTargets", DOC_ID), { eventCode: "OTHER" }));
    await assertFails(updateDoc(doc(asLead(), "scoutTargets", DOC_ID), { teamId: OTHER_TEAM_ID }));
    await assertFails(deleteDoc(doc(asLead(), "scoutTargets", DOC_ID)));
    await assertFails(deleteDoc(doc(testEnv.authenticatedContext(ADMIN_UID).firestore(), "scoutTargets", DOC_ID)));
  });

  it("accepts exactly what lib/scout-status/store.ts writes (a serverTimestamp-style Timestamp, all fields)", async () => {
    await assertSucceeds(
      setDoc(doc(asLead(), "scoutTargets", DOC_ID), {
        teamId: TEAM_ID,
        eventCode: EVENT,
        ranges: {},
        maxOverrides: {},
        individual: {},
        extraScouts: [],
        updatedBy: LEAD_UID,
        updatedAt: new Date(),
      })
    );
  });
});

// P19: several FTC teams under one account. Only admins/the owner edit `fieldTeams` and members'
// `fieldTeamIds`; a member can't change their own; assignments must reference teams that exist.
describe("P19 FTC teams", () => {
  const A = { id: "ft-3468", number: 3468, name: "Alpha" };
  const B = { id: "fteam_b", number: 35794, name: "Beta" };
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asOwner = () => testEnv.authenticatedContext(OWNER_UID).firestore();
  const teamWrite = (teams: { id: string }[], extra: Record<string, unknown> = {}) => ({
    fieldTeams: teams,
    fieldTeamIdList: teams.map((t) => t.id),
    number: 3468,
    name: null,
    ...extra,
  });

  // The state right after the migration: the team has fieldTeams + the id mirror, members have fieldTeamIds.
  async function seedMigrated(teams = [A, B]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await updateDoc(doc(db, "teams", TEAM_ID), teamWrite(teams));
      for (const uid of [OWNER_UID, ADMIN_UID, SCOUT_UID]) await updateDoc(doc(db, "users", uid), { fieldTeamIds: teams.map((t) => t.id) });
    });
  }

  describe("teams/{teamId}.fieldTeams", () => {
    it("lets an admin and the owner write a valid list, with its id mirror and an account name", async () => {
      await assertSucceeds(updateDoc(doc(asAdmin(), "teams", TEAM_ID), teamWrite([A, B], { accountName: "Our Org" })));
      await assertSucceeds(updateDoc(doc(asOwner(), "teams", TEAM_ID), teamWrite([B, A])));
      await assertSucceeds(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { accountName: null }));
    });

    it("blocks a non-admin member from editing them", async () => {
      await assertFails(updateDoc(doc(asScout(), "teams", TEAM_ID), teamWrite([A, B])));
      await assertFails(updateDoc(doc(asScout(), "teams", TEAM_ID), { accountName: "Mine now" }));
    });

    it("blocks an admin of a different team", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), {
          name: "Outsider Admin",
          email: "o@example.com",
          teamId: OTHER_TEAM_ID,
          primaryRole: "lead-scout",
          secondaryRoles: [],
          isAdmin: true,
          isOwner: false,
          themeId: "team",
        });
      });
      await assertFails(updateDoc(doc(testEnv.authenticatedContext(OTHER_TEAM_UID).firestore(), "teams", TEAM_ID), teamWrite([A, B])));
    });

    it("rejects an empty list, more than 10 teams, a missing or mismatched id mirror, and an over-long account name", async () => {
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), teamWrite([])));
      const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, number: i + 1, name: "" }));
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), teamWrite(eleven)));
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { fieldTeams: [A, B] })); // no mirror
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { fieldTeams: [A, B], fieldTeamIdList: [A.id] })); // size mismatch
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { accountName: "x".repeat(61) }));
    });

    it("leaves a not-yet-migrated team doc (no fieldTeams) fully usable for the existing admin writes", async () => {
      await assertSucceeds(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { activeEventCode: "USNYLI" }));
    });
  });

  describe("users/{uid}.fieldTeamIds", () => {
    it("blocks a member from changing their own assignment, but not their other own fields", async () => {
      await seedMigrated();
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { fieldTeamIds: [A.id] }));
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { fieldTeamIds: [] }));
      await assertSucceeds(updateDoc(doc(asScout(), "users", SCOUT_UID), { themeId: "pride-rainbow", activeFieldTeamId: B.id }));
    });

    it("lets a member who has never had a list (pre-migration) keep editing their own profile", async () => {
      await assertSucceeds(updateDoc(doc(asScout(), "users", SCOUT_UID), { themeId: "pride-rainbow", activeFieldTeamId: "ft-3468" }));
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { fieldTeamIds: ["ft-3468"] }));
    });

    it("lets an admin and the owner assign members, themselves included", async () => {
      await seedMigrated();
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { fieldTeamIds: [B.id] }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { fieldTeamIds: [A.id] }));
      await assertSucceeds(updateDoc(doc(asOwner(), "users", SCOUT_UID), { fieldTeamIds: [A.id, B.id] }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { fieldTeamIds: [] }));
    });

    it("never lets one member assign another", async () => {
      await seedMigrated();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "users", "scout-2"), {
          name: "Second",
          email: "s2@example.com",
          teamId: TEAM_ID,
          primaryRole: "match-scout",
          secondaryRoles: [],
          isAdmin: false,
          isOwner: false,
          themeId: "team",
          fieldTeamIds: [A.id, B.id],
        });
      });
      await assertFails(updateDoc(doc(asScout(), "users", "scout-2"), { fieldTeamIds: [A.id] }));
    });

    it("rejects ids that aren't FTC teams of the account, and non-lists", async () => {
      await seedMigrated();
      await assertFails(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { fieldTeamIds: ["nope"] }));
      await assertFails(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { fieldTeamIds: [A.id, "nope"] }));
      await assertFails(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { fieldTeamIds: A.id }));
    });

    it("still allows a role edit when the member's stored assignment has gone stale", async () => {
      await seedMigrated();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { fieldTeamIds: [A.id, "removed-team"] });
      });
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { primaryRole: "pit-scout" }));
    });

    it("lets one batch add an FTC team and assign a member to it, and another remove a team while reassigning its members", async () => {
      await seedMigrated([A]);
      const db = asAdmin();
      const add = writeBatch(db);
      add.update(doc(db, "teams", TEAM_ID), teamWrite([A, B]));
      add.update(doc(db, "users", SCOUT_UID), { fieldTeamIds: [A.id, B.id] });
      await assertSucceeds(add.commit());

      const remove = writeBatch(db);
      remove.update(doc(db, "teams", TEAM_ID), teamWrite([A]));
      remove.update(doc(db, "users", SCOUT_UID), { fieldTeamIds: [A.id] });
      await assertSucceeds(remove.commit());
    });

    it("rejects a batch that removes a team while assigning a member to it (checked against the post-batch team doc)", async () => {
      await seedMigrated([A, B]);
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users", SCOUT_UID), { fieldTeamIds: [A.id] });
      });
      const db = asAdmin();
      const batch = writeBatch(db);
      batch.update(doc(db, "teams", TEAM_ID), teamWrite([A]));
      batch.update(doc(db, "users", SCOUT_UID), { fieldTeamIds: [A.id, B.id] });
      await assertFails(batch.commit());
    });
  });

  describe("migration (existing members keep access)", () => {
    it("members of a not-yet-migrated account can still read the team and everyone's profile, and submit scouting", async () => {
      const db = asScout();
      await assertSucceeds(getDoc(doc(db, "teams", TEAM_ID)));
      await assertSucceeds(getDoc(doc(db, "users", ADMIN_UID)));
      await assertSucceeds(setDoc(doc(db, "scoutEntries", "e1"), { teamId: TEAM_ID, uid: SCOUT_UID, teamNumber: 254 }));
    });

    it("the same members have the same access after the migration has written fieldTeams and fieldTeamIds", async () => {
      await seedMigrated();
      const db = asScout();
      await assertSucceeds(getDoc(doc(db, "teams", TEAM_ID)));
      await assertSucceeds(getDoc(doc(db, "users", ADMIN_UID)));
      await assertSucceeds(setDoc(doc(db, "scoutEntries", "e2"), { teamId: TEAM_ID, uid: SCOUT_UID, teamNumber: 254 }));
    });

    it("never lets an outsider read the account's FTC teams", async () => {
      await seedMigrated();
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "teams", TEAM_ID)));
    });
  });
});

// P20: platform owner vs team owner, the application collections, and cross-account isolation.
describe("P20 owner model, applications and isolation", () => {
  const asOwner = () => testEnv.authenticatedContext(OWNER_UID).firestore();
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const asPlatform = (uid = "platform-1") => testEnv.authenticatedContext(uid, { platformOwner: true, admin: true }).firestore();
  const PLATFORM_UID = "platform-1";
  const B_TEAM = "team-b";
  const B_ADMIN = "b-admin";
  const B_SCOUT = "b-scout";

  async function setOwnerUid(uid: string | null) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "teams", TEAM_ID), uid ? { ownerUid: uid } : { ownerUid: deleteField() });
    });
  }

  // A second, separate account (what an approved application creates), with its own owner and a scout.
  async function seedAccountB() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "teams", B_TEAM), {
        number: 777, name: "Bee", joinCode: "BBBBBB", ownerUid: B_ADMIN, fieldTeams: [{ id: "ft-777", number: 777, name: "Bee" }], fieldTeamIdList: ["ft-777"], fieldTeamNumbers: [777], createdAt: new Date(),
      });
      await setDoc(doc(db, "users", B_ADMIN), { name: "B Admin", email: "b@example.com", teamId: B_TEAM, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: true, themeId: "team", fieldTeamIds: ["ft-777"] });
      await setDoc(doc(db, "users", B_SCOUT), { name: "B Scout", email: "bs@example.com", teamId: B_TEAM, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
      await setDoc(doc(db, "scoutEntries", "b-entry"), { teamId: B_TEAM, uid: B_SCOUT, teamNumber: 254 });
      await setDoc(doc(db, "scoutEntries", "a-entry"), { teamId: TEAM_ID, uid: SCOUT_UID, teamNumber: 254 });
      await setDoc(doc(db, "users", PLATFORM_UID), { name: "Platform Owner", email: "platform@example.com", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true, isOwner: false, isPlatformOwner: true, themeId: "team" });
    });
  }

  describe("team owner follows teams.ownerUid", () => {
    it("with an ownerUid set, that member has the owner protections and the legacy flag counts for nothing", async () => {
      await setOwnerUid(ADMIN_UID);
      // ADMIN_UID is now the owner: nobody else can edit their row...
      await assertFails(updateDoc(doc(asOwner(), "users", ADMIN_UID), { primaryRole: "media" }));
      // ...they can edit their own row (admin stays on), and everyone else's.
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { primaryRole: "team-coach" }));
      await assertFails(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { isAdmin: false }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", SCOUT_UID), { primaryRole: "pit-scout" }));
    });

    it("the old owner (stale legacy flag) loses the protections: they're an ordinary admin the new owner can edit", async () => {
      await setOwnerUid(ADMIN_UID);
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", OWNER_UID), { primaryRole: "media" }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "users", OWNER_UID), { isAdmin: false }));
    });

    it("and the old owner's flag no longer makes them the owner when they edit others", async () => {
      await setOwnerUid(ADMIN_UID);
      // as an admin they can still edit non-owners, but cannot edit the real owner's row
      await assertSucceeds(updateDoc(doc(asOwner(), "users", SCOUT_UID), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(asOwner(), "users", ADMIN_UID), { primaryRole: "media" }));
    });

    it("falls back to the legacy flag only while the account has no ownerUid (the bootstrap hasn't run: nobody is locked out)", async () => {
      await setOwnerUid(null);
      await assertSucceeds(updateDoc(doc(asOwner(), "users", OWNER_UID), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(asAdmin(), "users", OWNER_UID), { primaryRole: "media" }));
    });

    it("keeps ownerUid and pendingTransfer out of every client's reach, the owner's and admins' included", async () => {
      await setOwnerUid(OWNER_UID);
      for (const db of [asOwner(), asAdmin(), asScout()]) {
        await assertFails(updateDoc(doc(db, "teams", TEAM_ID), { ownerUid: SCOUT_UID }));
        await assertFails(updateDoc(doc(db, "teams", TEAM_ID), { ownerUid: deleteField() }));
        await assertFails(
          updateDoc(doc(db, "teams", TEAM_ID), { pendingTransfer: { id: "t", fromUid: OWNER_UID, toUid: SCOUT_UID, requestedAt: new Date(), expiresAt: new Date() } })
        );
      }
      // other team fields still work for admins and the owner
      await assertSucceeds(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { accountName: "Still editable" }));
      await assertSucceeds(updateDoc(doc(asOwner(), "teams", TEAM_ID), { activeEventCode: "USNYLI" }));
    });

    it("cannot be self-granted: nobody writes isOwner or isPlatformOwner on a user doc", async () => {
      await setOwnerUid(OWNER_UID);
      await assertFails(updateDoc(doc(asScout(), "users", SCOUT_UID), { isPlatformOwner: true }));
      await assertFails(updateDoc(doc(asAdmin(), "users", ADMIN_UID), { isPlatformOwner: true }));
      await assertFails(updateDoc(doc(asOwner(), "users", OWNER_UID), { isPlatformOwner: true }));
      await assertFails(updateDoc(doc(asOwner(), "users", SCOUT_UID), { isOwner: true }));
    });
  });

  describe("application collections", () => {
    const application = (applicantUid: string, status = "pending") => ({
      applicantUid, applicantName: "Applicant", applicantEmail: "a@example.com", teamNumber: 35792, teamName: "Alpha", role: "team-coach", verification: "I am the mentor.",
      status, createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
    });
    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, "teamApplications", "app-1"), application("applicant-1"));
        await setDoc(doc(db, "teamApplications", "app-2"), application("applicant-2"));
        await setDoc(doc(db, "applicationPrivate", "app-1"), { signals: {}, notes: "private", ipHash: "abc" });
        await setDoc(doc(db, "applicationBlocks", "email_x"), { type: "email", value: "x@example.com" });
        await setDoc(doc(db, "platformAuditLog", "log-1"), { action: "reject-application" });
        await setDoc(doc(db, "rateLimits", "ip_x_1"), { count: 2 });
      });
    });

    it("the platform owner reads and lists every application, and the private, block and audit data", async () => {
      const db = asPlatform();
      await assertSucceeds(getDoc(doc(db, "teamApplications", "app-1")));
      await assertSucceeds(getDocs(collection(db, "teamApplications")));
      await assertSucceeds(getDocs(query(collection(db, "teamApplications"), where("status", "==", "pending"))));
      await assertSucceeds(getDoc(doc(db, "applicationPrivate", "app-1")));
      await assertSucceeds(getDocs(collection(db, "applicationBlocks")));
      await assertSucceeds(getDocs(collection(db, "platformAuditLog")));
    });

    it("an applicant reads only their own application (and cannot list everyone's)", async () => {
      const mine = testEnv.authenticatedContext("applicant-1").firestore();
      await assertSucceeds(getDoc(doc(mine, "teamApplications", "app-1")));
      await assertSucceeds(getDocs(query(collection(mine, "teamApplications"), where("applicantUid", "==", "applicant-1"))));
      await assertFails(getDoc(doc(mine, "teamApplications", "app-2")));
      await assertFails(getDocs(collection(mine, "teamApplications")));
    });

    it("an applicant can't read the reviewer's private doc, blocks, the audit log or rate limits", async () => {
      const mine = testEnv.authenticatedContext("applicant-1").firestore();
      await assertFails(getDoc(doc(mine, "applicationPrivate", "app-1")));
      await assertFails(getDocs(collection(mine, "applicationBlocks")));
      await assertFails(getDocs(collection(mine, "platformAuditLog")));
      await assertFails(getDoc(doc(mine, "rateLimits", "ip_x_1")));
    });

    it("a team owner or admin is not a platform owner: they read no applications", async () => {
      await assertFails(getDoc(doc(asOwner(), "teamApplications", "app-1")));
      await assertFails(getDocs(collection(asAdmin(), "teamApplications")));
      await assertFails(getDoc(doc(asOwner(), "applicationPrivate", "app-1")));
    });

    it("signed-out visitors read nothing here", async () => {
      const anon = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(anon, "teamApplications", "app-1")));
      await assertFails(getDocs(collection(anon, "teamApplications")));
    });

    it("nobody writes any of it from a client, the platform owner and the applicant included", async () => {
      const mine = testEnv.authenticatedContext("applicant-1").firestore();
      await assertFails(setDoc(doc(mine, "teamApplications", "app-new"), application("applicant-1")));
      await assertFails(updateDoc(doc(mine, "teamApplications", "app-1"), { status: "approved" }));
      const platform = asPlatform();
      await assertFails(updateDoc(doc(platform, "teamApplications", "app-1"), { status: "approved" }));
      await assertFails(setDoc(doc(platform, "teamApplications", "app-new"), application("applicant-1")));
      await assertFails(updateDoc(doc(platform, "applicationPrivate", "app-1"), { notes: "edited" }));
      await assertFails(setDoc(doc(platform, "applicationBlocks", "email_y"), { type: "email" }));
      await assertFails(setDoc(doc(platform, "platformAuditLog", "log-2"), { action: "x" }));
      await assertFails(setDoc(doc(platform, "rateLimits", "ip_y_1"), { count: 0 }));
      await assertFails(deleteDoc(doc(platform, "teamApplications", "app-1")));
    });
  });

  describe("cross-account isolation", () => {
    beforeEach(seedAccountB);

    it("a new account's members can't read or write another account's data, in either direction", async () => {
      const b = testEnv.authenticatedContext(B_ADMIN).firestore();
      await assertFails(getDoc(doc(b, "teams", TEAM_ID)));
      await assertFails(getDoc(doc(b, "users", SCOUT_UID)));
      await assertFails(getDoc(doc(b, "scoutEntries", "a-entry")));
      await assertFails(getDocs(query(collection(b, "scoutEntries"), where("teamId", "==", TEAM_ID))));
      await assertFails(updateDoc(doc(b, "teams", TEAM_ID), { accountName: "hijacked" }));
      await assertFails(updateDoc(doc(b, "users", SCOUT_UID), { primaryRole: "media" }));
      await assertFails(setDoc(doc(b, "scoutEntries", "forged"), { teamId: TEAM_ID, uid: B_ADMIN, teamNumber: 1 }));
      // and the reverse
      const a = asOwner();
      await assertFails(getDoc(doc(a, "teams", B_TEAM)));
      await assertFails(getDoc(doc(a, "users", B_SCOUT)));
      await assertFails(getDoc(doc(a, "scoutEntries", "b-entry")));
      await assertFails(updateDoc(doc(a, "users", B_SCOUT), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(a, "teams", B_TEAM), { accountName: "hijacked" }));
      // each still has full access to its own
      await assertSucceeds(getDoc(doc(b, "scoutEntries", "b-entry")));
      await assertSucceeds(updateDoc(doc(b, "teams", B_TEAM), { accountName: "Bee Org" }));
    });

    it("the new account's owner can't touch ownership of another account, or their own from a client", async () => {
      const b = testEnv.authenticatedContext(B_ADMIN).firestore();
      await assertFails(updateDoc(doc(b, "teams", B_TEAM), { ownerUid: B_SCOUT }));
      await assertFails(updateDoc(doc(b, "teams", TEAM_ID), { ownerUid: B_ADMIN }));
    });

    it("platform-owner status gives no read access to any account's scouting data, its own included", async () => {
      const platform = asPlatform(); // a member of TEAM_ID with the claim
      // the application tools open for them...
      await assertSucceeds(getDocs(collection(platform, "teamApplications")));
      // ...but other accounts stay closed, and the claim adds nothing within their own account either
      await assertFails(getDoc(doc(platform, "teams", B_TEAM)));
      await assertFails(getDoc(doc(platform, "users", B_ADMIN)));
      await assertFails(getDoc(doc(platform, "scoutEntries", "b-entry")));
      await assertFails(getDocs(query(collection(platform, "scoutEntries"), where("teamId", "==", B_TEAM))));
      await assertFails(updateDoc(doc(platform, "teams", B_TEAM), { accountName: "x" }));
      await assertFails(updateDoc(doc(platform, "users", B_SCOUT), { primaryRole: "media" }));
      await assertFails(setDoc(doc(platform, "scoutEntries", "forged-2"), { teamId: B_TEAM, uid: PLATFORM_UID, teamNumber: 1 }));
    });

    it("a platform-owner claim on someone who isn't on an account opens nothing of it either", async () => {
      const drifter = testEnv.authenticatedContext("drifter", { platformOwner: true }).firestore();
      await assertFails(getDoc(doc(drifter, "teams", TEAM_ID)));
      await assertFails(getDoc(doc(drifter, "scoutEntries", "a-entry")));
      await assertSucceeds(getDocs(collection(drifter, "teamApplications")));
    });
  });
});

describe("P21: forms, form versions and teams.activeForms", () => {
  const FORM_ID = "pit-v1";
  const DOC_ID = `${TEAM_ID}_${FORM_ID}`;
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asOwner = () => testEnv.authenticatedContext(OWNER_UID).firestore();
  const asOutsider = () => testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();

  const form = (over: Record<string, unknown> = {}) => ({ id: FORM_ID, name: "Pit form", version: 1, sections: [], ...over });
  const formDoc = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    formId: FORM_ID,
    name: "Pit form",
    origin: "custom",
    publishedVersion: null,
    draft: form(),
    active: true,
    archived: false,
    createdBy: ADMIN_UID,
    ...over,
  });
  const versionDoc = (version: number, over: Record<string, unknown> = {}) => ({ teamId: TEAM_ID, formId: FORM_ID, version, form: form({ version }), createdBy: ADMIN_UID, ...over });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OTHER_TEAM_UID), { name: "Outsider", email: "o@example.com", teamId: OTHER_TEAM_ID, primaryRole: "match-scout", secondaryRoles: [], isAdmin: true, isOwner: false, themeId: "team" });
    });
  });

  const seedDoc = (over: Record<string, unknown> = {}) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "forms", DOC_ID), formDoc(over));
    });

  describe("forms/{teamId}_{formId}", () => {
    it("lets an admin and the owner create a form, and a teammate read it (get and the team query)", async () => {
      await assertSucceeds(setDoc(doc(asAdmin(), "forms", DOC_ID), formDoc()));
      await assertSucceeds(setDoc(doc(asOwner(), "forms", `${TEAM_ID}_other`), formDoc({ formId: "other" })));
      await assertSucceeds(getDoc(doc(asScout(), "forms", DOC_ID)));
      await assertSucceeds(getDocs(query(collection(asScout(), "forms"), where("teamId", "==", TEAM_ID))));
    });

    it("keeps a scout from writing a form", async () => {
      await assertFails(setDoc(doc(asScout(), "forms", DOC_ID), formDoc({ createdBy: SCOUT_UID })));
      await seedDoc();
      await assertFails(updateDoc(doc(asScout(), "forms", DOC_ID), { name: "Hacked" }));
    });

    it("isolates accounts: no reading, listing or writing another team's forms", async () => {
      await seedDoc();
      await assertFails(getDoc(doc(asOutsider(), "forms", DOC_ID)));
      await assertFails(getDocs(query(collection(asOutsider(), "forms"), where("teamId", "==", TEAM_ID))));
      await assertFails(updateDoc(doc(asOutsider(), "forms", DOC_ID), { name: "Hacked" }));
      await assertFails(setDoc(doc(asOutsider(), "forms", DOC_ID), formDoc()));
      await assertFails(setDoc(doc(asAdmin(), "forms", `${OTHER_TEAM_ID}_x`), formDoc({ teamId: OTHER_TEAM_ID, formId: "x" })));
    });

    it("requires the doc id to be {teamId}_{formId}, and refuses to move a form to another id or team", async () => {
      await assertFails(setDoc(doc(asAdmin(), "forms", "arbitrary"), formDoc()));
      await assertFails(setDoc(doc(asAdmin(), "forms", `${TEAM_ID}_wrong`), formDoc()));
      await seedDoc();
      await assertFails(updateDoc(doc(asAdmin(), "forms", DOC_ID), { formId: "renamed" }));
      await assertFails(updateDoc(doc(asAdmin(), "forms", DOC_ID), { teamId: OTHER_TEAM_ID }));
    });

    it("checks the doc's shape", async () => {
      const ref = () => doc(asAdmin(), "forms", DOC_ID);
      await assertFails(setDoc(ref(), formDoc({ formId: "bad id!" })));
      await assertFails(setDoc(ref(), formDoc({ name: "" })));
      await assertFails(setDoc(ref(), formDoc({ origin: "mystery" })));
      await assertFails(setDoc(ref(), formDoc({ active: "yes" })));
      await assertFails(setDoc(ref(), formDoc({ archived: null })));
      await assertFails(setDoc(ref(), formDoc({ publishedVersion: 0 })));
      await assertFails(setDoc(ref(), formDoc({ publishedVersion: "1" })));
      await assertFails(setDoc(ref(), formDoc({ draft: "x" })));
      await assertSucceeds(setDoc(ref(), formDoc({ draft: null, publishedVersion: 3, origin: "built-in-override" })));
    });

    it("never lets the published version go down or be cleared, and never deletes", async () => {
      await seedDoc({ publishedVersion: 3, draft: null });
      await assertFails(updateDoc(doc(asAdmin(), "forms", DOC_ID), { publishedVersion: 2 }));
      await assertFails(updateDoc(doc(asAdmin(), "forms", DOC_ID), { publishedVersion: null }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "forms", DOC_ID), { publishedVersion: 4 }));
      await assertSucceeds(updateDoc(doc(asAdmin(), "forms", DOC_ID), { archived: true }));
      await assertFails(deleteDoc(doc(asAdmin(), "forms", DOC_ID)));
      await assertFails(deleteDoc(doc(asOwner(), "forms", DOC_ID)));
    });
  });

  describe("forms/{id}/versions/{n} (immutable)", () => {
    const publish = (db: ReturnType<typeof asAdmin>, version: number, docOver: Record<string, unknown> = {}, verOver: Record<string, unknown> = {}) => {
      const batch = writeBatch(db);
      batch.set(doc(db, "forms", DOC_ID, "versions", String(version)), versionDoc(version, verOver));
      batch.set(doc(db, "forms", DOC_ID), formDoc({ publishedVersion: version, draft: null, ...docOver }));
      return batch.commit();
    };

    it("lets an admin publish a version together with the doc's bump, and a teammate read it", async () => {
      await assertSucceeds(publish(asAdmin(), 1));
      await assertSucceeds(getDoc(doc(asScout(), "forms", DOC_ID, "versions", "1")));
      await assertFails(getDoc(doc(asOutsider(), "forms", DOC_ID, "versions", "1")));
    });

    it("refuses a version not matched by the doc's publishedVersion, or whose number doesn't match its id", async () => {
      await assertFails(publish(asAdmin(), 1, { publishedVersion: 2 }));
      await assertFails(setDoc(doc(asAdmin(), "forms", DOC_ID, "versions", "5"), versionDoc(5))); // doc not bumped
      await assertFails(setDoc(doc(asAdmin(), "forms", DOC_ID, "versions", "7"), versionDoc(5)));
      await assertFails(publish(asAdmin(), 1, {}, { form: form({ id: "someone-elses" }) }));
    });

    it("refuses a scout, another team's admin and a stale (older or equal) version number", async () => {
      await assertFails(publish(asScout(), 1));
      await assertFails(publish(asOutsider(), 1));
      await assertSucceeds(publish(asAdmin(), 1));
      await assertSucceeds(publish(asOwner(), 2));
      await assertFails(publish(asAdmin(), 2)); // already exists: write-once
      await assertFails(publish(asAdmin(), 1));
    });

    it("never updates or deletes a published version", async () => {
      await assertSucceeds(publish(asAdmin(), 1));
      const ref = (db: ReturnType<typeof asAdmin>) => doc(db, "forms", DOC_ID, "versions", "1");
      await assertFails(updateDoc(ref(asAdmin()), { note: "tampered" }));
      await assertFails(setDoc(ref(asOwner()), versionDoc(1, { note: "tampered" })));
      await assertFails(deleteDoc(ref(asAdmin())));
      await assertFails(deleteDoc(ref(asOwner())));
    });
  });

  describe("teams/{teamId}.activeForms", () => {
    it("lets an admin and the owner map the season to a form", async () => {
      await assertSucceeds(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { "activeForms.biobuzz": "pit-v1" }));
      await assertSucceeds(updateDoc(doc(asOwner(), "teams", TEAM_ID), { activeForms: { biobuzz: "biobuzz" } }));
    });

    it("keeps a scout out, and refuses unknown seasons and malformed values", async () => {
      await assertFails(updateDoc(doc(asScout(), "teams", TEAM_ID), { "activeForms.biobuzz": "pit-v1" }));
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { "activeForms.unknown-season": "pit-v1" }));
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { "activeForms.biobuzz": 5 }));
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { "activeForms.biobuzz": "" }));
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { "activeForms.biobuzz": "x".repeat(41) }));
      await assertFails(updateDoc(doc(asAdmin(), "teams", TEAM_ID), { activeForms: "biobuzz" }));
    });
  });

  describe("scoutEntries written from a form (values + formVersion)", () => {
    const entry = (uid: string, over: Record<string, unknown> = {}) => ({
      teamId: TEAM_ID,
      uid,
      source: "event",
      mode: null,
      formId: FORM_ID,
      formVersion: 2,
      scoutName: "Scout Person",
      eventCode: "USNYLI",
      matchType: "Qualification",
      matchNumber: 4,
      teamNumber: 3468,
      values: { rating: 4, note: "fast" },
      score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
      scored: false,
      comments: "fast",
      submittedAt: new Date().toISOString(),
      excluded: false,
      autoFlags: [],
      manualFlags: [],
      accuracy: null,
      createdAt: new Date(),
      ...over,
    });

    it("lets a scout save a values-shaped entry (no legacy fields) under their own uid", async () => {
      await assertSucceeds(addDoc(collection(asScout(), "scoutEntries"), entry(SCOUT_UID)));
      await assertFails(addDoc(collection(asScout(), "scoutEntries"), entry(ADMIN_UID)));
    });

    it("still lets an admin edit it, and still not the author", async () => {
      const id = await seedEntry(testEnv, entry(SCOUT_UID));
      await assertSucceeds(updateDoc(doc(asAdmin(), "scoutEntries", id), { values: { rating: 5, note: "fixed" } }));
      await assertFails(updateDoc(doc(asScout(), "scoutEntries", id), { values: { rating: 1 } }));
    });
  });
});

describe("P23: formTemplates", () => {
  const PLATFORM = "platform-owner-1";
  const asScout = () => testEnv.authenticatedContext(SCOUT_UID).firestore();
  const asAdmin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
  const asOwner = () => testEnv.authenticatedContext(OWNER_UID).firestore();
  const asOutsider = () => testEnv.authenticatedContext(OTHER_TEAM_UID).firestore();
  const asPlatformOwner = () => testEnv.authenticatedContext(PLATFORM, { platformOwner: true }).firestore();
  const signedOut = () => testEnv.unauthenticatedContext().firestore();

  const tpl = (over: Record<string, unknown> = {}) => ({
    ownerTeamId: TEAM_ID,
    authorName: "Team 3468",
    visibility: "private",
    official: false,
    name: "Pit scouting",
    description: "Robot inspection",
    tags: ["pit"],
    version: 1,
    form: { id: "pit", name: "Pit", version: 0, sections: [] },
    checksum: "abc123",
    fieldCount: 4,
    sectionCount: 5,
    importCount: 0,
    reportCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = { email: "x@example.com", isAdmin: true, isOwner: false, themeId: "team", primaryRole: "match-scout", secondaryRoles: [] };
      await setDoc(doc(db, "users", OTHER_TEAM_UID), { ...base, name: "Outsider", teamId: OTHER_TEAM_ID });
      await setDoc(doc(db, "users", PLATFORM), { ...base, name: "Platform", teamId: "platform-team", isPlatformOwner: true });
    });
  });

  const seed = (id: string, over: Record<string, unknown> = {}) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "formTemplates", id), tpl(over));
    });

  describe("reading: private templates never leak", () => {
    it("lets the owning account (any member) read a private template, and list its own", async () => {
      await seed("p1");
      await assertSucceeds(getDoc(doc(asScout(), "formTemplates", "p1")));
      await assertSucceeds(getDocs(query(collection(asScout(), "formTemplates"), where("ownerTeamId", "==", TEAM_ID))));
    });

    it("keeps another account, a signed-out user and the platform owner out of a private template", async () => {
      await seed("p1");
      await seed("r1", { visibility: "rejected", rejectionReason: "no" });
      for (const id of ["p1", "r1"]) {
        await assertFails(getDoc(doc(asOutsider(), "formTemplates", id)));
        await assertFails(getDoc(doc(signedOut(), "formTemplates", id)));
        await assertFails(getDoc(doc(asPlatformOwner(), "formTemplates", id)));
      }
      await assertFails(getDocs(query(collection(asOutsider(), "formTemplates"), where("ownerTeamId", "==", TEAM_ID))));
      await assertFails(getDocs(query(collection(asPlatformOwner(), "formTemplates"), where("ownerTeamId", "==", TEAM_ID))));
      await assertFails(getDocs(collection(asOutsider(), "formTemplates"))); // an unfiltered list would include private ones
      // a public-only query returns none of them, and is allowed
      const publicOnly = await assertSucceeds(getDocs(query(collection(asOutsider(), "formTemplates"), where("visibility", "==", "public"))));
      expect(publicOnly.size).toBe(0);
    });

    it("lets any signed-in user read public templates (get and the public list), but not a signed-out user", async () => {
      await seed("pub", { visibility: "public", publishedAt: 5 });
      await seed("p1");
      await assertSucceeds(getDoc(doc(asOutsider(), "formTemplates", "pub")));
      await assertSucceeds(getDoc(doc(asScout(), "formTemplates", "pub")));
      const list = await assertSucceeds(getDocs(query(collection(asOutsider(), "formTemplates"), where("visibility", "==", "public"))));
      expect(list.docs.map((d) => d.id)).toEqual(["pub"]);
      await assertFails(getDoc(doc(signedOut(), "formTemplates", "pub")));
    });

    it("lets the platform owner (and only them) read what is waiting for review", async () => {
      await seed("w1", { visibility: "public-pending", requestedAt: 3 });
      await assertSucceeds(getDoc(doc(asPlatformOwner(), "formTemplates", "w1")));
      await assertSucceeds(getDocs(query(collection(asPlatformOwner(), "formTemplates"), where("visibility", "==", "public-pending"))));
      await assertFails(getDoc(doc(asOutsider(), "formTemplates", "w1")));
      await assertFails(getDocs(query(collection(asOutsider(), "formTemplates"), where("visibility", "==", "public-pending"))));
      await assertSucceeds(getDoc(doc(asScout(), "formTemplates", "w1"))); // the author's own account still sees it
    });
  });

  describe("creating and editing a private template", () => {
    it("lets the owner and admins create one, and not a scout or another account", async () => {
      await assertSucceeds(setDoc(doc(asAdmin(), "formTemplates", "a"), tpl()));
      await assertSucceeds(setDoc(doc(asOwner(), "formTemplates", "b"), tpl({ name: "Other" })));
      await assertFails(setDoc(doc(asScout(), "formTemplates", "c"), tpl()));
      await assertFails(setDoc(doc(asOutsider(), "formTemplates", "d"), tpl())); // claims TEAM_ID
      await assertFails(setDoc(doc(signedOut(), "formTemplates", "e"), tpl()));
    });

    it("refuses a template that starts public, official, used, reported, pending an update or past version 1", async () => {
      for (const over of [{ visibility: "public" }, { visibility: "public-pending" }, { official: true }, { importCount: 9 }, { reportCount: 1 }, { version: 2 }, { hasPendingUpdate: true }]) {
        await assertFails(setDoc(doc(asAdmin(), "formTemplates", "x"), tpl(over)));
      }
    });

    it("checks the shape: name, description, tags, form and counts", async () => {
      for (const over of [{ name: "" }, { name: "x".repeat(81) }, { description: "x".repeat(501) }, { tags: "pit" }, { tags: Array(11).fill("t") }, { form: "nope" }, { checksum: 5 }, { fieldCount: "4" }, { authorName: "x".repeat(81) }]) {
        await assertFails(setDoc(doc(asAdmin(), "formTemplates", "x"), tpl(over)));
      }
    });

    it("lets the author edit it (and bump its version) while it is private, but never change what is server-owned", async () => {
      await seed("p1");
      const ref = (db: ReturnType<typeof asAdmin>) => doc(db, "formTemplates", "p1");
      await assertSucceeds(updateDoc(ref(asAdmin()), { name: "Renamed", version: 2, updatedAt: 2 }));
      await assertFails(updateDoc(ref(asAdmin()), { version: 1 })); // never goes back
      await assertFails(updateDoc(ref(asAdmin()), { visibility: "public" }));
      await assertFails(updateDoc(ref(asAdmin()), { visibility: "public-pending" }));
      await assertFails(updateDoc(ref(asAdmin()), { official: true }));
      await assertFails(updateDoc(ref(asAdmin()), { importCount: 1000 }));
      await assertFails(updateDoc(ref(asAdmin()), { reportCount: 0, importCount: 5 }));
      await assertFails(updateDoc(ref(asAdmin()), { ownerTeamId: OTHER_TEAM_ID }));
      await assertFails(updateDoc(ref(asAdmin()), { hasPendingUpdate: true }));
      await assertFails(updateDoc(ref(asScout()), { name: "Hacked" }));
      await assertFails(updateDoc(ref(asOutsider()), { name: "Hacked" }));
    });

    it("lets the author fix a rejected template (it becomes private again) but not touch one that is pending or public", async () => {
      await seed("rej", { visibility: "rejected", rejectionReason: "needs work" });
      await assertSucceeds(updateDoc(doc(asAdmin(), "formTemplates", "rej"), { visibility: "private", name: "Fixed" }));
      await seed("pend", { visibility: "public-pending" });
      await seed("pub", { visibility: "public" });
      for (const id of ["pend", "pub"]) {
        await assertFails(updateDoc(doc(asAdmin(), "formTemplates", id), { name: "Changed after approval" }));
        await assertFails(updateDoc(doc(asAdmin(), "formTemplates", id), { visibility: "private" })); // unpublishing goes through the server
        await assertFails(updateDoc(doc(asPlatformOwner(), "formTemplates", id), { visibility: "public", official: true })); // not even the platform owner from a browser
      }
    });
  });

  describe("deleting", () => {
    it("lets the author delete a private or rejected template, and nothing that is pending or public", async () => {
      await seed("p1");
      await seed("r1", { visibility: "rejected" });
      await seed("w1", { visibility: "public-pending" });
      await seed("pub", { visibility: "public" });
      await assertSucceeds(deleteDoc(doc(asAdmin(), "formTemplates", "p1")));
      await assertSucceeds(deleteDoc(doc(asOwner(), "formTemplates", "r1")));
      await assertFails(deleteDoc(doc(asAdmin(), "formTemplates", "w1")));
      await assertFails(deleteDoc(doc(asAdmin(), "formTemplates", "pub")));
    });

    it("never lets a scout, another account or the platform owner delete one from a browser", async () => {
      await seed("p1");
      await assertFails(deleteDoc(doc(asScout(), "formTemplates", "p1")));
      await assertFails(deleteDoc(doc(asOutsider(), "formTemplates", "p1")));
      await assertFails(deleteDoc(doc(asPlatformOwner(), "formTemplates", "p1")));
    });
  });

  describe("pending updates, reports and use counts (server-written)", () => {
    const seedSubs = () =>
      testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, "formTemplates", "pub", "updates", "pending"), { version: 2, name: "New", form: {}, checksum: "x" });
        await setDoc(doc(db, "formTemplates", "pub", "reports", OTHER_TEAM_ID), { teamId: OTHER_TEAM_ID, reason: "spam" });
        await setDoc(doc(db, "formTemplates", "pub", "imports", OTHER_TEAM_ID), { teamId: OTHER_TEAM_ID });
      });

    it("shows a pending update to the author's account and the platform owner only", async () => {
      await seed("pub", { visibility: "public", hasPendingUpdate: true });
      await seedSubs();
      await assertSucceeds(getDoc(doc(asScout(), "formTemplates", "pub", "updates", "pending")));
      await assertSucceeds(getDoc(doc(asPlatformOwner(), "formTemplates", "pub", "updates", "pending")));
      await assertFails(getDoc(doc(asOutsider(), "formTemplates", "pub", "updates", "pending")));
      await assertFails(getDoc(doc(signedOut(), "formTemplates", "pub", "updates", "pending")));
    });

    it("shows reports and use counts to the platform owner only", async () => {
      await seed("pub", { visibility: "public" });
      await seedSubs();
      for (const sub of ["reports", "imports"]) {
        await assertSucceeds(getDocs(collection(asPlatformOwner(), "formTemplates", "pub", sub)));
        await assertFails(getDocs(collection(asAdmin(), "formTemplates", "pub", sub)));
        await assertFails(getDocs(collection(asOutsider(), "formTemplates", "pub", sub)));
      }
    });

    it("lets nobody write any of them from a browser (so a report or a use can't be forged or inflated)", async () => {
      await seed("pub", { visibility: "public" });
      for (const who of [asAdmin(), asOwner(), asOutsider(), asPlatformOwner()]) {
        await assertFails(setDoc(doc(who, "formTemplates", "pub", "updates", "pending"), { version: 2 }));
        await assertFails(setDoc(doc(who, "formTemplates", "pub", "reports", "x"), { reason: "spam" }));
        await assertFails(setDoc(doc(who, "formTemplates", "pub", "imports", "x"), { teamId: "x" }));
        await assertFails(updateDoc(doc(who, "formTemplates", "pub"), { importCount: 999 }));
        await assertFails(updateDoc(doc(who, "formTemplates", "pub"), { reportCount: 0 }));
      }
    });
  });
});

// FIX4: a profile's owner can always read and edit it (even private); the visibility toggle works both ways for a
// non-admin, and is refused only for admins and the owner (forced public). Mirrors lib/profile/service.ts saveOwnProfile
// exactly: ONE batch of the profile write plus the users/{uid}.avatar mirror, so a refusal of either fails the toggle.
describe("FIX4: profile visibility, every viewer x every state", () => {
  const MATE = "fix4-mate";
  const asUid = (uid: string) => testEnv.authenticatedContext(uid).firestore();
  const base = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM_ID,
    displayName: "Scouty",
    bio: "Likes counting.",
    pronouns: "",
    avatar: { type: "initials", value: "" },
    visibility: "public",
    updatedAt: serverTimestamp(),
    ...over,
  });
  /** What saveOwnProfile commits. */
  async function saveOwn(uid: string, visibility: "public" | "private", over: Record<string, unknown> = {}) {
    const db = asUid(uid);
    const batch = writeBatch(db);
    batch.set(doc(db, "profiles", uid), base({ visibility, ...over }));
    batch.update(doc(db, "users", uid), { avatar: { type: "initials", value: "" } });
    await batch.commit();
  }
  const seed = (uid: string, visibility: "public" | "private") =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "profiles", uid), base({ visibility, updatedAt: new Date() }));
    });

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", MATE), { name: "Mate", email: "m@example.com", teamId: TEAM_ID, primaryRole: "pit-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
    });
  });

  it("a non-admin flips public -> private -> public with the app's own save batch, first save included", async () => {
    await assertSucceeds(saveOwn(SCOUT_UID, "private")); // first save: a create
    expect((await getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID))).data()?.visibility).toBe("private");
    await assertSucceeds(saveOwn(SCOUT_UID, "public"));
    expect((await getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID))).data()?.visibility).toBe("public");
    await assertSucceeds(saveOwn(SCOUT_UID, "private"));
    await assertSucceeds(saveOwn(SCOUT_UID, "public", { bio: "edited" }));
  });

  it("a non-admin with a pre-existing profile flips it", async () => {
    await seed(SCOUT_UID, "public");
    await assertSucceeds(saveOwn(SCOUT_UID, "private"));
    await assertSucceeds(saveOwn(SCOUT_UID, "public"));
  });

  it("the owner of a profile reads and edits it in BOTH states, whoever they are", async () => {
    for (const uid of [SCOUT_UID, MATE]) {
      for (const v of ["public", "private"] as const) {
        await seed(uid, v);
        await assertSucceeds(getDoc(doc(asUid(uid), "profiles", uid)));
        await assertSucceeds(updateDoc(doc(asUid(uid), "profiles", uid), { bio: `bio ${v}`, updatedAt: serverTimestamp() }));
      }
    }
  });

  it("admins and the owner can't flip to private (forced public), but can still read and edit their own and save the same value", async () => {
    for (const uid of [ADMIN_UID, OWNER_UID]) {
      await assertFails(saveOwn(uid, "private"));
      await assertSucceeds(saveOwn(uid, "public"));
      await assertSucceeds(saveOwn(uid, "public", { bio: "edited" }));
      await assertSucceeds(getDoc(doc(asUid(uid), "profiles", uid)));
    }
  });

  it("who can read a profile: a private one is closed to a non-admin teammate and open to its owner and every admin; a public one to the whole team", async () => {
    await seed(SCOUT_UID, "private");
    await assertSucceeds(getDoc(doc(asUid(SCOUT_UID), "profiles", SCOUT_UID))); // yourself
    await assertSucceeds(getDoc(doc(asUid(ADMIN_UID), "profiles", SCOUT_UID))); // an admin
    await assertSucceeds(getDoc(doc(asUid(OWNER_UID), "profiles", SCOUT_UID))); // the owner
    await assertFails(getDoc(doc(asUid(MATE), "profiles", SCOUT_UID))); // a teammate: the limited card
    await seed(SCOUT_UID, "public");
    await assertSucceeds(getDoc(doc(asUid(MATE), "profiles", SCOUT_UID)));
  });
});

// P31: the Pit Scouting and Team Strategy assignments share `assignments/` with Match Scouting: the same readers and writers (Assignments page access), and a doc that
// names a kind must be one of the two with the matching id.
describe("P31: team assignments (assignments/{teamId}_{eventCode}_{pit|teamStrategy})", () => {
  const LEAD = "p31-lead"; // primary Lead Scout: has Assignments by default
  const MEDIA = "p31-media"; // no Assignments access
  const OUTSIDER = "p31-outsider"; // another team's admin
  const EVENT = "USWABON1";
  const asUid = (uid: string) => testEnv.authenticatedContext(uid).firestore();
  const version = { generatedBy: LEAD, generatedAt: "2026-11-08T10:00:00.000Z", settings: { scoutUids: [SCOUT_UID], priorityTeams: [], priorityCoverage: 2, mode: "balanced-random", includeOurs: false, seed: 1 }, teams: [{ teamNumber: 100, scoutUids: [SCOUT_UID], locked: false }], counts: { [SCOUT_UID]: 1 }, uneven: false, warning: null };
  const data = (kind: string, over: Record<string, unknown> = {}) => ({ teamId: TEAM_ID, eventCode: EVENT, kind, current: version, previous: null, updatedAt: new Date(), ...over });
  const id = (kind: string) => `${TEAM_ID}_${EVENT}_${kind}`;

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = { email: "x@example.com", isAdmin: false, isOwner: false, themeId: "team" };
      await setDoc(doc(db, "users", LEAD), { ...base, name: "Lead", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [] });
      await setDoc(doc(db, "users", MEDIA), { ...base, name: "Media", teamId: TEAM_ID, primaryRole: "media", secondaryRoles: [] });
      await setDoc(doc(db, "users", OUTSIDER), { ...base, name: "Out", teamId: OTHER_TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true });
    });
  });

  it("people with Assignments access (an admin, a Lead Scout) write both kinds; nobody else does", async () => {
    for (const kind of ["pit", "teamStrategy"]) {
      await assertSucceeds(setDoc(doc(asUid(LEAD), "assignments", id(kind)), data(kind)));
      await assertSucceeds(setDoc(doc(asUid(ADMIN_UID), "assignments", id(kind)), data(kind, { previous: version })));
      await assertFails(setDoc(doc(asUid(SCOUT_UID), "assignments", id(kind)), data(kind)));
      await assertFails(setDoc(doc(asUid(MEDIA), "assignments", id(kind)), data(kind)));
      await assertFails(setDoc(doc(asUid(OUTSIDER), "assignments", id(kind)), data(kind)));
    }
  });

  it("a scout who is assigned can read it (so can the whole team), as a team-scoped query; another team cannot", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "assignments", id("pit")), data("pit"));
    });
    const q = (uid: string) => getDocs(query(collection(asUid(uid), "assignments"), where("teamId", "==", TEAM_ID)));
    expect((await assertSucceeds(q(SCOUT_UID))).size).toBe(1);
    expect((await assertSucceeds(q(MEDIA))).size).toBe(1);
    await assertSucceeds(getDoc(doc(asUid(SCOUT_UID), "assignments", id("pit"))));
    await assertFails(getDoc(doc(asUid(OUTSIDER), "assignments", id("pit"))));
    await assertFails(getDocs(query(collection(asUid(OUTSIDER), "assignments"), where("teamId", "==", TEAM_ID))));
  });

  it("the kind and the id must agree, and only the two kinds exist", async () => {
    const lead = asUid(LEAD);
    await assertFails(setDoc(doc(lead, "assignments", id("pit")), data("teamStrategy"))); // pit's id, strategy's kind
    await assertFails(setDoc(doc(lead, "assignments", id("pit")), data("other")));
    await assertFails(setDoc(doc(lead, "assignments", `${TEAM_ID}_${EVENT}`), data("pit"))); // Match Scouting's id
    await assertFails(setDoc(doc(lead, "assignments", `${TEAM_ID}_OTHEREVENT_pit`), data("pit"))); // another event's id
    await assertSucceeds(setDoc(doc(lead, "assignments", `${TEAM_ID}_${EVENT}`), { teamId: TEAM_ID, eventCode: EVENT, current: null, previous: null })); // Match Scouting still works, no kind
  });

  it("never in another team's name, never deleted", async () => {
    await assertFails(setDoc(doc(asUid(LEAD), "assignments", id("pit")), data("pit", { teamId: OTHER_TEAM_ID })));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "assignments", id("pit")), data("pit"));
    });
    await assertFails(deleteDoc(doc(asUid(ADMIN_UID), "assignments", id("pit"))));
  });
});

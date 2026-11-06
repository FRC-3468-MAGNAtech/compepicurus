import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { summarizeBulk, validateBulk } from "@/lib/library/bulk";
import { buildManualMatchDoc, emptyRawMatch, validateRawMatch } from "@/lib/library/manual-match";
import { applyPickOp, sanitizePicks, type PickOp } from "@/lib/pick-list/ops";
import { setDoc, doc, getDoc, getDocs, updateDoc, deleteDoc, collection, addDoc, writeBatch, runTransaction, query, where } from "firebase/firestore";

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

  it("lets an admin set several active events with the primary in the list", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
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

    it("also accepts the owner claim alone, when the doc flag hasn't caught up", async () => {
      await withRulesOff(async (db) => {
        await setDoc(doc(db, "users", CLAIM_UID), { name: "Claim Owner", email: "c@example.com", teamId: TEAM_ID, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
      });
      const db = testEnv.authenticatedContext(CLAIM_UID, { owner: true }).firestore();
      await assertSucceeds(updateDoc(doc(db, "users", SCOUT_UID), { primaryRole: "media" }));
      // ...but the claim never lets anyone edit an owner they aren't, or write isOwner.
      await assertFails(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "media" }));
      await assertFails(updateDoc(doc(db, "users", CLAIM_UID), { isOwner: true }));
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

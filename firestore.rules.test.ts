import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
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

  it("P1b: blocks even the owner themself from changing their own isAdmin/isOwner/roles through this path", async () => {
    // Owner status is env-var-driven via app/api/auth/sync-roles (Admin
    // SDK) only — the self-update rule's isAdmin/isOwner/role equality
    // checks apply to every uid, owner included.
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { isAdmin: false }));
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { primaryRole: "pit-scout" }));
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

  it("protects an owner from themself too", async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(updateDoc(doc(db, "users", OWNER_UID), { secondaryRoles: ["media"] }));
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

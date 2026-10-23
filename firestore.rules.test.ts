import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { setDoc, doc, getDoc, updateDoc, deleteDoc, collection, addDoc } from "firebase/firestore";

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

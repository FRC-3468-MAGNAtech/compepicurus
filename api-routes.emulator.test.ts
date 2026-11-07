import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore as getClientFirestore } from "firebase/firestore";

// Unverified in this environment — no Java / firebase-tools available here
// to run the Firebase Emulator Suite (Auth + Firestore both needed). Run
// with `npm run test:api` (added alongside test:rules) once both are
// installed locally. See docs/ASSUMPTIONS.md, P1b.
//
// Covers the prompt's explicit API-test asks: team creation succeeds once
// and is then rejected (including a simulated race), unverified emails
// never receive owner/admin, a verified owner email gets claims, and the
// public config route reports the right flag.

// `firebase emulators:exec` runs the Auth emulator under the project in .firebaserc and
// exports it as GCLOUD_PROJECT; the emulator mints ID tokens with *that* audience no matter
// what projectId the client app claims, and the Admin SDK rejects a token whose audience
// differs from its own project. So the whole test must use the emulator's project id (the
// original hardcoded "compepicurus-api-test" made every verifyIdToken call fail with
// `incorrect "aud"` — FIX2).
const PROJECT_ID = process.env.GCLOUD_PROJECT || "compepicurus-api-test";

// The Admin SDK only needs credentials that *parse* to construct a client when
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST redirect every call
// to the local emulators — neither emulator validates them. firebase-admin
// really does parse the PEM, so a hand-written placeholder isn't enough:
// generate a throwaway RSA key at runtime (nothing secret, never persisted).
const { privateKey: THROWAWAY_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT_ID;
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_ADMIN_PRIVATE_KEY = THROWAWAY_PRIVATE_KEY;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.OWNER_EMAILS = "owner@example.com";
process.env.ADMIN_EMAILS = "preset-admin@example.com";

const { POST: createTeam } = await import("@/app/api/team/create/route");
const { POST: joinTeam } = await import("@/app/api/team/join/route");
const { POST: syncRoles } = await import("@/app/api/auth/sync-roles/route");
const { POST: syncFieldTeams } = await import("@/app/api/team/sync-field-teams/route");
const { GET: publicConfig } = await import("@/app/api/public/config/route");
const { getAdminAuth, getAdminFirestore } = await import("@/lib/firebase/admin");

let clientApp: FirebaseApp;
let clientAuth: Auth;

async function createTestUser(email: string, opts: { verified?: boolean } = {}): Promise<string> {
  const credential = await createUserWithEmailAndPassword(clientAuth, email, "password123");
  if (opts.verified) {
    const adminAuth = getAdminAuth()!;
    await adminAuth.updateUser(credential.user.uid, { emailVerified: true });
    // The client's cached token still says unverified until it re-fetches.
    await credential.user.getIdToken(true);
  }
  return credential.user.getIdToken();
}

function postJson(body: unknown, idToken?: string): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: "fake-api-key" }, "api-routes-test");
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  connectFirestoreEmulator(getClientFirestore(clientApp), "127.0.0.1", 8080);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

beforeEach(async () => {
  const db = getAdminFirestore()!;
  const adminAuth = getAdminAuth()!;
  const collections = await db.listCollections();
  await Promise.all(
    collections.map(async (col) => {
      const docs = await col.listDocuments();
      await Promise.all(docs.map((d) => d.delete()));
    })
  );
  const { users } = await adminAuth.listUsers();
  await Promise.all(users.map((u) => adminAuth.deleteUser(u.uid)));
});

describe("POST /api/team/create", () => {
  it("creates a team, makes the caller admin, and disables further creation", async () => {
    const idToken = await createTestUser("first-admin@example.com");
    const res = await createTeam(postJson({ teamNumber: 3468, teamName: "MAGNAtech", name: "First Admin" }, idToken));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.joinCode).toBe("string");

    const config = await (await publicConfig()).json();
    expect(config.teamCreationEnabled).toBe(false);
  });

  it("rejects a second creation attempt once disabled", async () => {
    const firstToken = await createTestUser("first-admin@example.com");
    await createTeam(postJson({ teamNumber: 3468 }, firstToken));

    const secondToken = await createTestUser("second-admin@example.com");
    const res = await createTeam(postJson({ teamNumber: 9999 }, secondToken));
    expect(res.status).toBe(403);
    expect((await res.json()).ok).toBe(false);
  });

  it("only lets one of two simultaneous create attempts win (simulated race)", async () => {
    const tokenA = await createTestUser("racer-a@example.com");
    const tokenB = await createTestUser("racer-b@example.com");

    const [resA, resB] = await Promise.all([
      createTeam(postJson({ teamNumber: 1111 }, tokenA)),
      createTeam(postJson({ teamNumber: 2222 }, tokenB)),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);
    const successes = [bodyA, bodyB].filter((b) => b.ok === true);
    expect(successes).toHaveLength(1);
  });

  it("rejects a caller who's already on a team", async () => {
    const idToken = await createTestUser("already-on-team@example.com");
    await createTeam(postJson({ teamNumber: 1 }, idToken));
    const res = await createTeam(postJson({ teamNumber: 2 }, idToken));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/team/join", () => {
  it("joins an existing team by its join code as a non-admin", async () => {
    const creatorToken = await createTestUser("creator@example.com");
    const { joinCode } = await (await createTeam(postJson({ teamNumber: 42 }, creatorToken))).json();

    const joinerToken = await createTestUser("joiner@example.com");
    const res = await joinTeam(postJson({ joinCode, name: "Joiner" }, joinerToken));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects a join code that doesn't match any team", async () => {
    const idToken = await createTestUser("lost@example.com");
    const res = await joinTeam(postJson({ joinCode: "NOPE99" }, idToken));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/public/config", () => {
  it("reports teamCreationEnabled: true before any team exists", async () => {
    const body = await (await publicConfig()).json();
    expect(body.teamCreationEnabled).toBe(true);
  });

  it("reports teamCreationEnabled: false once a team exists", async () => {
    const idToken = await createTestUser("admin@example.com");
    await createTeam(postJson({ teamNumber: 1 }, idToken));
    const body = await (await publicConfig()).json();
    expect(body.teamCreationEnabled).toBe(false);
  });
});

describe("POST /api/auth/sync-roles", () => {
  it("never grants owner or admin for an unverified email, even if it matches OWNER_EMAILS", async () => {
    const idToken = await createTestUser("owner@example.com", { verified: false });
    const res = await syncRoles(postJson({}, idToken));
    const body = await res.json();
    expect(body.changed).toBe(false);
    expect(body.attached ?? false).toBe(false);
    // FIX2: nothing is granted, but the owner is told why instead of controls silently missing.
    expect(body.ownerPendingVerification).toBe(true);

    const adminAuth = getAdminAuth()!;
    const record = await adminAuth.getUserByEmail("owner@example.com");
    expect(record.customClaims?.owner).toBeFalsy();
  });

  it("only flags ownerPendingVerification for an owner email — not for anyone else who is unverified", async () => {
    const idToken = await createTestUser("someone-else@example.com", { verified: false });
    const body = await (await syncRoles(postJson({}, idToken))).json();
    expect(body.ownerPendingVerification).toBe(false);
  });

  it("stops flagging ownerPendingVerification once the owner's email is verified, and applies owner access", async () => {
    const idToken = await createTestUser("owner@example.com", { verified: false });
    await createTeam(postJson({ teamNumber: 3468, name: "Owner" }, idToken));
    expect((await (await syncRoles(postJson({}, idToken))).json()).ownerPendingVerification).toBe(true);

    const adminAuth = getAdminAuth()!;
    const record = await adminAuth.getUserByEmail("owner@example.com");
    await adminAuth.updateUser(record.uid, { emailVerified: true });
    // The client's cached token still says unverified until it's refreshed (lib/auth.tsx's recheckOwnerAccess does this).
    await signInWithEmailAndPassword(clientAuth, "owner@example.com", "password123");
    const freshToken = await clientAuth.currentUser!.getIdToken(true);
    const body = await (await syncRoles(postJson({}, freshToken))).json();
    expect(body.ownerPendingVerification).toBeFalsy();
    expect(body.changed).toBe(true);
    const userDoc = await getAdminFirestore()!.collection("users").doc(record.uid).get();
    expect(userDoc.data()).toMatchObject({ isOwner: true, isAdmin: true });
  });

  it("grants owner + admin, and sets custom claims, for a verified OWNER_EMAILS match", async () => {
    // The sole-member owner (FIX2): they created the team (so they have a profile, with isOwner
    // false at first), and the sync after sign-in is what makes them the owner. A verified owner
    // with *no* profile and no single team to attach to is deliberately left alone (next test).
    const idToken = await createTestUser("owner@example.com", { verified: true });
    await createTeam(postJson({ teamNumber: 3468, name: "Owner" }, idToken));
    await syncRoles(postJson({}, idToken));

    const adminAuth = getAdminAuth()!;
    const db = getAdminFirestore()!;
    const record = await adminAuth.getUserByEmail("owner@example.com");
    expect(record.customClaims?.owner).toBe(true);
    expect(record.customClaims?.admin).toBe(true);

    const userDoc = await db.collection("users").doc(record.uid).get();
    expect(userDoc.data()?.isOwner).toBe(true);
    expect(userDoc.data()?.isAdmin).toBe(true);
  });

  it("auto-attaches a verified owner with no profile to the one existing team", async () => {
    const creatorToken = await createTestUser("creator-y@example.com", { verified: true });
    await createTeam(postJson({ teamNumber: 7 }, creatorToken));

    const ownerToken = await createTestUser("owner@example.com", { verified: true });
    const res = await syncRoles(postJson({}, ownerToken));
    const body = await res.json();
    expect(body.attached).toBe(true);
  });

  it("grants admin (not owner) for a verified ADMIN_EMAILS match", async () => {
    const idToken = await createTestUser("preset-admin@example.com", { verified: true });
    const creatorToken = await createTestUser("creator-z@example.com", { verified: true });
    const { joinCode } = await (await createTeam(postJson({ teamNumber: 3 }, creatorToken))).json();
    await joinTeam(postJson({ joinCode }, idToken));

    await syncRoles(postJson({}, idToken));
    const adminAuth = getAdminAuth()!;
    const record = await adminAuth.getUserByEmail("preset-admin@example.com");
    expect(record.customClaims?.admin).toBe(true);
    expect(record.customClaims?.owner).toBeFalsy();
  });
});

// P19: the FTC-teams migration and the paths that create new accounts/members.
describe("P19 FTC teams", () => {
  // Rolls an account back to the pre-P19 shape (what production looks like before the first sign-in after deploy).
  async function makeLegacy(teamId: string, number: number, name: string | null) {
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = getAdminFirestore()!;
    await db.collection("teams").doc(teamId).update({ number, name, fieldTeams: FieldValue.delete(), fieldTeamIdList: FieldValue.delete() });
    const users = await db.collection("users").where("teamId", "==", teamId).get();
    await Promise.all(users.docs.map((d) => d.ref.update({ fieldTeamIds: FieldValue.delete() })));
  }

  async function uidOf(email: string) {
    return (await getAdminAuth()!.getUserByEmail(email)).uid;
  }

  it("a created team starts with its number as the first FTC team, and the creator is on it", async () => {
    const token = await createTestUser("maker@example.com");
    const { teamId } = await (await createTeam(postJson({ teamNumber: 35792, teamName: "Alpha" }, token))).json();
    const db = getAdminFirestore()!;
    const team = (await db.collection("teams").doc(teamId).get()).data()!;
    expect(team.fieldTeams).toEqual([{ id: "ft-35792", number: 35792, name: "Alpha" }]);
    expect(team.fieldTeamIdList).toEqual(["ft-35792"]);
    expect(team.number).toBe(35792);
    expect((await db.collection("users").doc(await uidOf("maker@example.com")).get()).data()?.fieldTeamIds).toEqual(["ft-35792"]);
  });

  it("a new member joins on every FTC team of the account", async () => {
    const creator = await createTestUser("creator-ft@example.com");
    const { teamId, joinCode } = await (await createTeam(postJson({ teamNumber: 35792, teamName: "Alpha" }, creator))).json();
    const db = getAdminFirestore()!;
    await db.collection("teams").doc(teamId).update({
      fieldTeams: [
        { id: "ft-35792", number: 35792, name: "Alpha" },
        { id: "fteam_b", number: 35794, name: "Beta" },
      ],
      fieldTeamIdList: ["ft-35792", "fteam_b"],
    });
    const joiner = await createTestUser("joiner-ft@example.com");
    await joinTeam(postJson({ joinCode, name: "Joiner" }, joiner));
    expect((await db.collection("users").doc(await uidOf("joiner-ft@example.com")).get()).data()?.fieldTeamIds).toEqual(["ft-35792", "fteam_b"]);
  });

  describe("POST /api/team/sync-field-teams", () => {
    async function legacyAccount() {
      const adminToken = await createTestUser("legacy-admin@example.com");
      const { teamId, joinCode } = await (await createTeam(postJson({ teamNumber: 35792, teamName: "Alpha" }, adminToken))).json();
      const memberToken = await createTestUser("legacy-member@example.com");
      await joinTeam(postJson({ joinCode, name: "Member" }, memberToken));
      await makeLegacy(teamId, 35792, "Alpha");
      return { teamId, adminToken, memberToken };
    }

    it("migrates the legacy number into the first FTC team and gives every existing member all teams", async () => {
      const { teamId, memberToken } = await legacyAccount();
      const res = await syncFieldTeams(postJson({}, memberToken));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, teamMigrated: true, membersMigrated: 2 });

      const db = getAdminFirestore()!;
      const team = (await db.collection("teams").doc(teamId).get()).data()!;
      expect(team.fieldTeams).toEqual([{ id: "ft-35792", number: 35792, name: "Alpha" }]);
      expect(team.fieldTeamIdList).toEqual(["ft-35792"]);
      expect(team.number).toBe(35792); // the legacy field is kept
      for (const email of ["legacy-admin@example.com", "legacy-member@example.com"]) {
        expect((await db.collection("users").doc(await uidOf(email)).get()).data()?.fieldTeamIds).toEqual(["ft-35792"]);
      }
    });

    it("is idempotent: a second run changes nothing, and never overwrites an admin's later assignments", async () => {
      const { teamId, adminToken, memberToken } = await legacyAccount();
      await syncFieldTeams(postJson({}, adminToken));

      const db = getAdminFirestore()!;
      // an admin later adds a second team and narrows the member to it
      await db.collection("teams").doc(teamId).update({
        fieldTeams: [
          { id: "ft-35792", number: 35792, name: "Alpha" },
          { id: "fteam_b", number: 35794, name: "Beta" },
        ],
        fieldTeamIdList: ["ft-35792", "fteam_b"],
      });
      const memberUid = await uidOf("legacy-member@example.com");
      await db.collection("users").doc(memberUid).update({ fieldTeamIds: ["fteam_b"] });

      const again = await (await syncFieldTeams(postJson({}, memberToken))).json();
      expect(again).toMatchObject({ ok: true, teamMigrated: false, membersMigrated: 0 });
      expect((await db.collection("teams").doc(teamId).get()).data()?.fieldTeams).toHaveLength(2);
      expect((await db.collection("users").doc(memberUid).get()).data()?.fieldTeamIds).toEqual(["fteam_b"]);
    });

    it("only fills in members that have no list, so a half-migrated account finishes cleanly", async () => {
      const { teamId, adminToken } = await legacyAccount();
      const db = getAdminFirestore()!;
      const adminUid = await uidOf("legacy-admin@example.com");
      await db.collection("users").doc(adminUid).update({ fieldTeamIds: ["ft-35792"] });
      const res = await (await syncFieldTeams(postJson({}, adminToken))).json();
      expect(res).toMatchObject({ teamMigrated: true, membersMigrated: 1 });
      expect((await db.collection("teams").doc(teamId).get()).data()?.fieldTeamIdList).toEqual(["ft-35792"]);
    });

    it("leaves a signed-in user with no team yet alone, and rejects an unauthenticated call", async () => {
      const token = await createTestUser("no-team@example.com");
      expect(await (await syncFieldTeams(postJson({}, token))).json()).toMatchObject({ ok: true, skipped: true });
      expect((await syncFieldTeams(postJson({}))).status).toBe(401);
    });

    it("only ever touches the caller's own account", async () => {
      const { teamId } = await legacyAccount();
      // a second, separate legacy account
      const otherDb = getAdminFirestore()!;
      const otherRef = otherDb.collection("teams").doc("other-account");
      await otherRef.set({ number: 111, name: "Other", joinCode: "OTHER1", createdAt: new Date() });
      const strangerToken = await createTestUser("stranger@example.com");
      const strangerUid = await uidOf("stranger@example.com");
      await otherDb.collection("users").doc(strangerUid).set({
        name: "Stranger", email: "stranger@example.com", teamId: "other-account", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team",
      });
      await syncFieldTeams(postJson({}, strangerToken));
      expect((await otherRef.get()).data()?.fieldTeams).toEqual([{ id: "ft-111", number: 111, name: "Other" }]);
      expect((await otherDb.collection("teams").doc(teamId).get()).data()?.fieldTeams).toBeUndefined();
    });
  });
});

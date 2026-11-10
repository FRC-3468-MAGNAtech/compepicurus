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
const { POST: submitApplication } = await import("@/app/api/applications/route");
const { GET: startToken } = await import("@/app/api/applications/start/route");
const { POST: reviewApplication } = await import("@/app/api/admin/applications/route");
const { GET: applicationConfig } = await import("@/app/api/admin/application-config/route");
const { POST: transfer } = await import("@/app/api/team/transfer/route");
const { GET: listTeams } = await import("@/app/api/admin/teams/route");
const { POST: setTeamCreation } = await import("@/app/api/admin/team-creation/route");
const serverTokens = await import("@/lib/server/application-token");
const { POST: templatesRoute } = await import("@/app/api/templates/route");
const templateLib = await import("@/lib/templates/build");
const formLib = await import("@/lib/forms/new-form");
const portableLib = await import("@/lib/forms/portable");
const { FieldValue } = await import("firebase-admin/firestore");
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
    expect(record.customClaims?.platformOwner).toBeFalsy();
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

  it("grants platform owner + admin, and sets the platformOwner claim, for a verified OWNER_EMAILS match", async () => {
    // The sole-member owner (FIX2): they created the team (so they have a profile, with isOwner
    // false at first), and the sync after sign-in is what makes them the owner. A verified owner
    // with *no* profile and no single team to attach to is deliberately left alone (next test).
    const idToken = await createTestUser("owner@example.com", { verified: true });
    await createTeam(postJson({ teamNumber: 3468, name: "Owner" }, idToken));
    await syncRoles(postJson({}, idToken));

    const adminAuth = getAdminAuth()!;
    const db = getAdminFirestore()!;
    const record = await adminAuth.getUserByEmail("owner@example.com");
    expect(record.customClaims?.platformOwner).toBe(true);
    expect(record.customClaims?.owner).toBeUndefined(); // the pre-P20 claim is gone
    expect(record.customClaims?.admin).toBe(true);

    const userDoc = await db.collection("users").doc(record.uid).get();
    expect(userDoc.data()?.isPlatformOwner).toBe(true);
    expect(userDoc.data()?.isOwner).toBe(true); // they created the team, so they are its team owner too
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
    expect(record.customClaims?.platformOwner).toBeFalsy();
  });
});

// P19: the FTC-teams migration and the paths that create new accounts/members.
describe("P19 FTC teams", () => {
  // Rolls an account back to the pre-P19 shape (what production looks like before the first sign-in after deploy).
  async function makeLegacy(teamId: string, number: number, name: string | null) {
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = getAdminFirestore()!;
    await db.collection("teams").doc(teamId).update({ number, name, fieldTeams: FieldValue.delete(), fieldTeamIdList: FieldValue.delete(), fieldTeamNumbers: FieldValue.delete() });
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
      fieldTeamNumbers: [35792, 35794],
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
        fieldTeamNumbers: [35792, 35794],
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

// ---------------------------------------------------------------------------------------------
// P20: platform owner vs team owner, the application flow, the review actions and ownership transfer.
// ---------------------------------------------------------------------------------------------
describe("P20", () => {
  const { issueStartToken } = serverTokens;
  let ipCounter = 10;
  const nextIp = () => `203.0.113.${ipCounter++}`;

  const uidOfEmail = async (email: string) => (await getAdminAuth()!.getUserByEmail(email)).uid;
  const asJson = (body: unknown, token?: string, ip?: string) =>
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { "x-forwarded-for": ip } : {}) },
      body: JSON.stringify(body),
    });
  const asGet = (token?: string) => new Request("http://localhost/api", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const freshToken = async (email: string) => {
    await signInWithEmailAndPassword(clientAuth, email, "password123");
    return clientAuth.currentUser!.getIdToken(true);
  };
  const docData = async (path: string) => (await getAdminFirestore()!.doc(path).get()).data();
  // Public creation locks the moment a team exists; the helpers below build several accounts, so they open it first (as the platform owner would).
  const enableCreation = () => getAdminFirestore()!.doc("appSettings/global").set({ teamCreationEnabled: true });

  /** The platform owner (owner@example.com, in OWNER_EMAILS) with a team account of their own (FTC 1) and the claim on a fresh token. */
  async function platformOwner() {
    const first = await createTestUser("owner@example.com", { verified: true });
    await enableCreation();
    const { teamId, joinCode } = await (await createTeam(postJson({ teamNumber: 1, teamName: "Platform Team", name: "Pat Owner" }, first))).json();
    await syncRoles(postJson({}, first));
    return { token: await freshToken("owner@example.com"), teamId, joinCode, uid: await uidOfEmail("owner@example.com") };
  }

  /** A team account (created by `creatorEmail`, who becomes its team owner) with one extra member who is an admin and verified. */
  async function accountWithAdmin(number: number, creatorEmail: string, adminEmail: string) {
    const creatorToken = await createTestUser(creatorEmail, { verified: true });
    await enableCreation();
    const { teamId, joinCode } = await (await createTeam(postJson({ teamNumber: number, teamName: `Team ${number}`, name: "Creator" }, creatorToken))).json();
    const adminToken = await createTestUser(adminEmail, { verified: true });
    await joinTeam(postJson({ joinCode, name: "Second Admin" }, adminToken));
    const adminUid = await uidOfEmail(adminEmail);
    await getAdminFirestore()!.collection("users").doc(adminUid).update({ isAdmin: true });
    return { teamId, joinCode, creatorUid: await uidOfEmail(creatorEmail), adminUid };
  }

  // -------------------------------------------------------------------------------------------
  describe("platform owner vs team owner", () => {
    it("a created team's creator is its team owner (ownerUid) and the owner mirror agrees", async () => {
      const token = await createTestUser("maker@example.com");
      const { teamId } = await (await createTeam(postJson({ teamNumber: 5 }, token))).json();
      const uid = await uidOfEmail("maker@example.com");
      expect((await docData(`teams/${teamId}`))?.ownerUid).toBe(uid);
      expect((await docData(`users/${uid}`))?.isOwner).toBe(true);
    });

    it("bootstrap: an account with no owner keeps its existing (legacy-flagged) owner, whoever signs in first", async () => {
      const { teamId, creatorUid, adminUid } = await accountWithAdmin(42, "legacy-owner@example.com", "legacy-admin@example.com");
      const db = getAdminFirestore()!;
      await db.collection("teams").doc(teamId).update({ ownerUid: FieldValue.delete() }); // an account from before P20
      const token = await freshToken("legacy-admin@example.com");
      const res = await syncRoles(postJson({}, token));
      expect((await res.json()).changed).toBe(true);
      expect((await docData(`teams/${teamId}`))?.ownerUid).toBe(creatorUid); // the flagged owner, not the member who signed in
      expect((await docData(`users/${adminUid}`))?.isOwner).toBe(false);
    });

    it("bootstrap: with several legacy owners the earliest-created wins and the rest are demoted to admins", async () => {
      const { teamId, creatorUid, adminUid } = await accountWithAdmin(43, "o1@example.com", "o2@example.com");
      const db = getAdminFirestore()!;
      await db.collection("teams").doc(teamId).update({ ownerUid: FieldValue.delete() });
      await db.collection("users").doc(adminUid).update({ isOwner: true, createdAt: new Date(Date.now() + 60_000) });
      await db.collection("users").doc(creatorUid).update({ createdAt: new Date(Date.now() - 60_000) });
      await syncRoles(postJson({}, await freshToken("o2@example.com")));
      expect((await docData(`teams/${teamId}`))?.ownerUid).toBe(creatorUid);
      expect(await docData(`users/${adminUid}`)).toMatchObject({ isOwner: false, isAdmin: true });
    });

    it("bootstrap: an ownerless account with nobody flagged is claimed by a signing-in platform owner, and only by one", async () => {
      const creator = await createTestUser("someone@example.com", { verified: true });
      const { teamId, joinCode } = await (await createTeam(postJson({ teamNumber: 44 }, creator))).json();
      const db = getAdminFirestore()!;
      const creatorUid = await uidOfEmail("someone@example.com");
      await db.collection("teams").doc(teamId).update({ ownerUid: FieldValue.delete() });
      await db.collection("users").doc(creatorUid).update({ isOwner: false });

      // an ordinary member signing in does not take it
      await syncRoles(postJson({}, await freshToken("someone@example.com")));
      expect((await docData(`teams/${teamId}`))?.ownerUid).toBeUndefined();

      // the platform owner joins that account and signs in: they become its team owner
      const platform = await createTestUser("owner@example.com", { verified: true });
      await joinTeam(postJson({ joinCode, name: "Pat" }, platform));
      await syncRoles(postJson({}, await freshToken("owner@example.com")));
      const platformUid = await uidOfEmail("owner@example.com");
      expect((await docData(`teams/${teamId}`))?.ownerUid).toBe(platformUid);
      expect(await docData(`users/${platformUid}`)).toMatchObject({ isOwner: true, isAdmin: true, isPlatformOwner: true });
    });

    it("sync-roles never re-asserts ownership: after a transfer the platform owner signing in changes nothing", async () => {
      const { token: platformToken, teamId, joinCode, uid: platformUid } = await platformOwner();
      const adminToken = await createTestUser("successor@example.com", { verified: true });
      await joinTeam(postJson({ joinCode, name: "Successor" }, adminToken));
      const successorUid = await uidOfEmail("successor@example.com");
      await getAdminFirestore()!.collection("users").doc(successorUid).update({ isAdmin: true });

      // the platform owner (the team's owner, as its creator) hands the account over
      await transfer(asJson({ action: "request", toUid: successorUid, confirm: "1" }, await freshToken("owner@example.com")));
      expect((await (await transfer(asJson({ action: "accept" }, await freshToken("successor@example.com")))).json()).result).toBe("accepted");
      expect((await docData(`teams/${teamId}`))?.ownerUid).toBe(successorUid);

      // ...and then signs in again, over and over: platform owner status never takes it back
      for (let i = 0; i < 2; i++) {
        const res = await syncRoles(postJson({}, await freshToken("owner@example.com")));
        expect((await res.json()).ok).toBe(true);
      }
      expect((await docData(`teams/${teamId}`))?.ownerUid).toBe(successorUid);
      expect(await docData(`users/${platformUid}`)).toMatchObject({ isOwner: false, isAdmin: true, isPlatformOwner: true });
      void platformToken;
    });

    it("grants the platformOwner claim from OWNER_EMAILS and takes it (and the old `owner` claim) away when the email leaves the list", async () => {
      const { teamId } = await platformOwner();
      void teamId;
      const adminAuth = getAdminAuth()!;
      expect((await adminAuth.getUserByEmail("owner@example.com")).customClaims).toMatchObject({ platformOwner: true, admin: true });
      // a pre-P20 token still carrying `owner`: the next sync strips it
      const uid = await uidOfEmail("owner@example.com");
      await adminAuth.setCustomUserClaims(uid, { owner: true, platformOwner: true, admin: true });
      const stale = await freshToken("owner@example.com");
      await syncRoles(postJson({}, stale));
      expect((await adminAuth.getUserByEmail("owner@example.com")).customClaims?.owner).toBeUndefined();

      const previous = process.env.OWNER_EMAILS;
      process.env.OWNER_EMAILS = "someone-else@example.com";
      try {
        await syncRoles(postJson({}, await freshToken("owner@example.com")));
      } finally {
        process.env.OWNER_EMAILS = previous;
      }
      expect((await adminAuth.getUserByEmail("owner@example.com")).customClaims?.platformOwner).toBe(false);
      expect(await docData(`users/${uid}`)).toMatchObject({ isPlatformOwner: false, isAdmin: true }); // admin is never auto-revoked
    });

    it("only a platform owner can switch public team creation: a team owner, an admin and an unverified owner email cannot", async () => {
      const { token } = await platformOwner();
      const ok = await setTeamCreation(asJson({ enabled: true }, token));
      expect(ok.status).toBe(200);
      expect((await (await publicConfig()).json()).teamCreationEnabled).toBe(true);

      await getAdminFirestore()!.doc("appSettings/global").set({ teamCreationEnabled: false });
      const { creatorUid } = await accountWithAdmin(60, "teamowner@example.com", "teamadmin@example.com");
      void creatorUid;
      expect((await setTeamCreation(asJson({ enabled: true }, await freshToken("teamowner@example.com")))).status).toBe(403);
      expect((await setTeamCreation(asJson({ enabled: true }, await freshToken("teamadmin@example.com")))).status).toBe(403);
      expect((await setTeamCreation(asJson({ enabled: true }))).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("POST /api/applications", () => {
    const body = (over: Record<string, unknown> = {}) => ({
      name: "Ada Lovelace",
      teamNumber: "35792",
      teamName: "Alpha Bots",
      role: "team-coach",
      verification: "I'm the lead mentor; our team page is linked here.",
      link: "https://example.org/team",
      startToken: issueStartToken(Date.now() - 10_000),
      turnstileToken: null,
      orgUrl: "",
      ...over,
    });
    const verifiedApplicant = async (email = "ada@example.com") => createTestUser(email, { verified: true });

    it("needs a signed-in, verified email", async () => {
      expect((await submitApplication(asJson(body(), undefined, nextIp()))).status).toBe(401);
      const unverified = await createTestUser("unverified@example.com", { verified: false });
      const res = await submitApplication(asJson(body(), unverified, nextIp()));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("email-unverified");
      expect((await getAdminFirestore()!.collection("teamApplications").get()).size).toBe(0);
    });

    it("files a pending application with its private signals, and stores a hash, never the IP", async () => {
      const token = await verifiedApplicant();
      const ip = nextIp();
      const res = await submitApplication(asJson(body(), token, ip));
      expect(res.status).toBe(200);
      const { applicationId } = await res.json();

      const app = (await docData(`teamApplications/${applicationId}`))!;
      expect(app).toMatchObject({ status: "pending", teamNumber: 35792, role: "team-coach", applicantEmail: "ada@example.com", teamId: null });
      expect(app.expiresAt.toMillis() - app.createdAt.toMillis()).toBeGreaterThan(29.9 * 86_400_000);
      expect(app.expiresAt.toMillis() - app.createdAt.toMillis()).toBeLessThan(30.1 * 86_400_000);

      const priv = (await docData(`applicationPrivate/${applicationId}`))!;
      expect(priv.signals).toMatchObject({ emailVerified: true, turnstile: "not-configured", emailDomain: "example.com", freeEmailProvider: false, existingAccountForNumber: false });
      expect(priv.signals.firstApi.status).toMatch(/error|found|not-found/); // no FIRST credentials in the test: "error"
      expect(priv.ipHash).toMatch(/^[0-9a-f]{32}$/);
      const everything = JSON.stringify([app, priv, (await getAdminFirestore()!.collection("rateLimits").get()).docs.map((d) => d.data()), (await getAdminFirestore()!.collection("rateLimits").get()).docs.map((d) => d.id)]);
      expect(everything).not.toContain(ip);
      expect((await getAdminFirestore()!.collection("platformAuditLog").get()).size).toBe(1);
    });

    it("refuses a filled honeypot, a too-quick or missing or tampered start token, and files nothing", async () => {
      const token = await verifiedApplicant();
      const cases: [Record<string, unknown>, number, string][] = [
        [{ orgUrl: "http://spam.example" }, 400, "rejected"],
        [{ startToken: issueStartToken(Date.now()) }, 400, "too-fast"],
        [{ startToken: undefined }, 400, "form-expired"],
        [{ startToken: `${issueStartToken(Date.now() - 10_000)}x` }, 400, "form-expired"],
        [{ startToken: issueStartToken(Date.now() - 3 * 60 * 60 * 1000) }, 400, "form-expired"],
      ];
      for (const [over, status, code] of cases) {
        const res = await submitApplication(asJson(body(over), token, nextIp()));
        expect(res.status, JSON.stringify(over)).toBe(status);
        expect((await res.json()).code).toBe(code);
      }
      expect((await getAdminFirestore()!.collection("teamApplications").get()).size).toBe(0);
    });

    it("validates and reports every field problem; text is sanitized and bounded", async () => {
      const token = await verifiedApplicant();
      const bad = await submitApplication(asJson(body({ name: "A", teamNumber: "123456", role: "wizard", verification: "short", link: "javascript:alert(1)" }), token, nextIp()));
      expect(bad.status).toBe(400);
      expect(Object.keys((await bad.json()).fields).sort()).toEqual(["link", "name", "role", "teamNumber", "verification"]);

      const res = await submitApplication(asJson(body({ name: "  Ada\u0000   <b>L</b> ", verification: `${"x".repeat(3000)}` }), token, nextIp()));
      expect(res.status).toBe(200);
      const app = (await getAdminFirestore()!.collection("teamApplications").get()).docs[0].data();
      expect(app.applicantName).toBe("Ada <b>L</b>"); // control characters gone, whitespace collapsed (HTML is escaped at render time, never trusted)
      expect(app.verification.length).toBe(1200);
    });

    it("rejects a disposable email domain", async () => {
      const token = await createTestUser("burner@mailinator.com", { verified: true });
      const res = await submitApplication(asJson(body(), token, nextIp()));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("disposable-email");
    });

    it("limits one IP to 3 applications an hour (the 4th is refused)", async () => {
      const ip = nextIp();
      const results: number[] = [];
      for (let i = 0; i < 4; i++) {
        const token = await verifiedApplicant(`bulk${i}@example.com`);
        results.push((await submitApplication(asJson(body({ teamNumber: String(1000 + i), startToken: issueStartToken(Date.now() - 10_000) }), token, ip))).status);
      }
      expect(results).toEqual([200, 200, 200, 429]);
    });

    it("allows one pending application per applicant, per email (aliases included) and per team number", async () => {
      const first = await verifiedApplicant("ada.l@gmail.com");
      expect((await submitApplication(asJson(body(), first, nextIp()))).status).toBe(200);
      // the same person again
      expect((await (await submitApplication(asJson(body({ teamNumber: "2222" }), first, nextIp()))).json()).code).toBe("duplicate");
      // another person, the same team number
      const other = await verifiedApplicant("grace@example.com");
      expect((await (await submitApplication(asJson(body(), other, nextIp()))).json()).code).toBe("duplicate");
      // the same mailbox under an alias (dots and +tag on Gmail)
      const alias = await verifiedApplicant("adal+robots@gmail.com");
      expect((await (await submitApplication(asJson(body({ teamNumber: "3333" }), alias, nextIp()))).json()).code).toBe("duplicate");
    });

    it("lets an applicant apply again after a rejection, and ignores an expired pending application", async () => {
      const { token: platformToken } = await platformOwner();
      const token = await verifiedApplicant();
      const { applicationId } = await (await submitApplication(asJson(body(), token, nextIp()))).json();
      const rejected = await reviewApplication(asJson({ action: "reject", applicationId, reason: "Please link your team page." }, platformToken));
      expect(rejected.status).toBe(200);
      const again = await submitApplication(asJson(body({ startToken: issueStartToken(Date.now() - 10_000) }), token, nextIp()));
      expect(again.status).toBe(200);

      // an old pending application (past its 30 days) no longer blocks the same team number from a new applicant
      const secondId = (await (await submitApplication(asJson(body({ teamNumber: "4444", startToken: issueStartToken(Date.now() - 10_000) }), await verifiedApplicant("late@example.com"), nextIp()))).json()).applicationId;
      await getAdminFirestore()!.collection("teamApplications").doc(secondId).update({ expiresAt: new Date(Date.now() - 1000) });
      const retry = await submitApplication(asJson(body({ teamNumber: "4444", startToken: issueStartToken(Date.now() - 10_000) }), await verifiedApplicant("later@example.com"), nextIp()));
      expect(retry.status).toBe(200);
    });

    it("refuses an applicant who is already on a team, and a team number some account already has", async () => {
      const { token: platformToken } = await platformOwner(); // FTC 1
      void platformToken;
      expect((await (await submitApplication(asJson(body(), await freshToken("owner@example.com"), nextIp()))).json()).code).toBe("already-member");

      await accountWithAdmin(777, "creator777@example.com", "admin777@example.com");
      const res = await submitApplication(asJson(body({ teamNumber: "777" }), await verifiedApplicant("newcomer@example.com"), nextIp()));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("account-exists");
      // an account's SECOND FTC team counts too (the numbers mirror)
      const { teamId } = await accountWithAdmin(888, "creator888@example.com", "admin888@example.com");
      await getAdminFirestore()!.collection("teams").doc(teamId).update({ fieldTeamNumbers: [888, 889] });
      expect((await (await submitApplication(asJson(body({ teamNumber: "889" }), await verifiedApplicant("newcomer2@example.com"), nextIp()))).json()).code).toBe("account-exists");
    });

    it("refuses a blocked email or team number", async () => {
      const { token: platformToken } = await platformOwner();
      const token = await verifiedApplicant("blockme@example.com");
      const { applicationId } = await (await submitApplication(asJson(body(), token, nextIp()))).json();
      expect((await reviewApplication(asJson({ action: "block", applicationId, blockEmail: true, blockTeam: true, reason: "spam" }, platformToken))).status).toBe(200);

      // the blocked email, for another team
      const sameEmail = await submitApplication(asJson(body({ teamNumber: "5555", startToken: issueStartToken(Date.now() - 10_000) }), token, nextIp()));
      expect((await sameEmail.json()).code).toBe("blocked");
      // the blocked team number, from someone else
      const sameTeam = await submitApplication(asJson(body({ startToken: issueStartToken(Date.now() - 10_000) }), await verifiedApplicant("someone-new@example.com"), nextIp()));
      expect((await sameTeam.json()).code).toBe("blocked");

      // unblocking lets them back in
      const blocks = await getAdminFirestore()!.collection("applicationBlocks").get();
      expect(blocks.size).toBe(2);
      for (const b of blocks.docs) expect((await reviewApplication(asJson({ action: "unblock", blockId: b.id }, platformToken))).status).toBe(200);
      expect((await submitApplication(asJson(body({ teamNumber: "5555", startToken: issueStartToken(Date.now() - 10_000) }), token, nextIp()))).status).toBe(200);
    });

    it("issues a signed start token with no sign-in, and the config route reports Turnstile as not configured to platform owners only", async () => {
      const res = await startToken();
      expect(typeof (await res.json()).token).toBe("string");
      const { token } = await platformOwner();
      const config = await (await applicationConfig(asGet(token))).json();
      expect(config).toMatchObject({ turnstileSecretConfigured: false, emailConfigured: false });
      expect((await applicationConfig(asGet(await verifiedApplicant("not-owner@example.com")))).status).toBe(403);
      expect((await applicationConfig(asGet())).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("POST /api/admin/applications (the review queue)", () => {
    const apply = async (email: string, teamNumber: string, over: Record<string, unknown> = {}) => {
      const token = await createTestUser(email, { verified: true });
      const res = await submitApplication(
        asJson(
          { name: "Ada Lovelace", teamNumber, teamName: `Team ${teamNumber}`, role: "lead-strategist", verification: "I'm the lead mentor; see our page.", link: "", startToken: issueStartToken(Date.now() - 10_000), turnstileToken: null, orgUrl: "", ...over },
          token,
          nextIp()
        )
      );
      return { token, applicationId: (await res.json()).applicationId as string, uid: await uidOfEmail(email) };
    };

    it("is for platform owners only", async () => {
      const { token: platformToken } = await platformOwner();
      const applicant = await apply("applicant@example.com", "9001");
      expect((await reviewApplication(asJson({ action: "approve", applicationId: applicant.applicationId }))).status).toBe(401);
      expect((await reviewApplication(asJson({ action: "approve", applicationId: applicant.applicationId }, applicant.token))).status).toBe(403);
      // a team owner / admin of another account is not a platform owner either
      await accountWithAdmin(61, "someowner@example.com", "someadmin@example.com");
      expect((await reviewApplication(asJson({ action: "approve", applicationId: applicant.applicationId }, await freshToken("someowner@example.com")))).status).toBe(403);
      // and a platform owner's claim is checked against the live OWNER_EMAILS list too
      const previous = process.env.OWNER_EMAILS;
      process.env.OWNER_EMAILS = "nobody@example.com";
      try {
        expect((await reviewApplication(asJson({ action: "approve", applicationId: applicant.applicationId }, platformToken))).status).toBe(403);
      } finally {
        process.env.OWNER_EMAILS = previous;
      }
      expect((await docData(`teamApplications/${applicant.applicationId}`))?.status).toBe("pending");
    });

    it("approve creates the team account in one go: join code, the applied FTC team, ownerUid = applicant, applicant is admin, audit entries written", async () => {
      const { token: platformToken, uid: platformUid, teamId: platformTeamId } = await platformOwner();
      const a = await apply("approved@example.com", "9002");
      const res = await reviewApplication(asJson({ action: "approve", applicationId: a.applicationId }, platformToken));
      expect(res.status).toBe(200);
      const { teamId } = await res.json();

      const team = (await docData(`teams/${teamId}`))!;
      expect(team).toMatchObject({ number: 9002, ownerUid: a.uid, fieldTeamNumbers: [9002], fieldTeamIdList: ["ft-9002"], applicationId: a.applicationId });
      expect(team.fieldTeams).toEqual([{ id: "ft-9002", number: 9002, name: "Team 9002" }]);
      expect(team.joinCode).toMatch(/^[A-Z2-9]{6}$/);
      expect(await docData(`users/${a.uid}`)).toMatchObject({ teamId, isAdmin: true, isOwner: true, primaryRole: "lead-strategist", fieldTeamIds: ["ft-9002"], name: "Ada Lovelace" });
      expect(await docData(`teamApplications/${a.applicationId}`)).toMatchObject({ status: "approved", teamId, decidedBy: platformUid });

      const db = getAdminFirestore()!;
      const audit = await db.collection("auditLog").where("teamId", "==", teamId).get();
      expect(audit.docs.map((d) => d.data().action)).toEqual(["approve-team-application"]);
      expect(JSON.stringify(audit.docs[0].data())).not.toContain("approved@example.com"); // the new account's own log carries no applicant details
      const platformLog = await db.collection("platformAuditLog").get();
      expect(platformLog.docs.map((d) => d.data().action).sort()).toEqual(["approve-application", "submit-application"]);

      // the platform owner gained nothing in the new account, and the new account has none of theirs
      expect((await db.collection("users").where("teamId", "==", teamId).get()).docs.map((d) => d.id)).toEqual([a.uid]);
      expect((await docData(`users/${platformUid}`))?.teamId).toBe(platformTeamId);
    });

    it("approval is atomic and idempotent: simultaneous approvals create exactly one team; deciding twice, an expired one, or one whose applicant already joined a team all fail cleanly", async () => {
      const { token: platformToken } = await platformOwner();
      const a = await apply("racer@example.com", "9003");
      const db = getAdminFirestore()!;
      const before = (await db.collection("teams").get()).size;
      const [r1, r2] = await Promise.all([
        reviewApplication(asJson({ action: "approve", applicationId: a.applicationId }, platformToken)),
        reviewApplication(asJson({ action: "approve", applicationId: a.applicationId }, platformToken)),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect((await db.collection("teams").get()).size).toBe(before + 1);
      expect((await (await reviewApplication(asJson({ action: "reject", applicationId: a.applicationId, reason: "too late" }, platformToken))).json()).code).toBe("already-decided");

      const expired = await apply("expired@example.com", "9004");
      await db.collection("teamApplications").doc(expired.applicationId).update({ expiresAt: new Date(Date.now() - 1000) });
      expect((await (await reviewApplication(asJson({ action: "approve", applicationId: expired.applicationId }, platformToken))).json()).code).toBe("expired");

      const joined = await apply("joined@example.com", "9005");
      await db.collection("users").doc(joined.uid).set({ name: "J", email: "joined@example.com", teamId: "some-team", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, themeId: "team" });
      const teamsBefore = (await db.collection("teams").get()).size;
      expect((await (await reviewApplication(asJson({ action: "approve", applicationId: joined.applicationId }, platformToken))).json()).code).toBe("already-member");
      expect((await db.collection("teams").get()).size).toBe(teamsBefore);
      expect((await docData(`teamApplications/${joined.applicationId}`))?.status).toBe("pending");
    });

    it("won't approve a team number another account has, or an applicant who lost their verified email", async () => {
      const { token: platformToken } = await platformOwner();
      const a = await apply("dupe@example.com", "9006");
      await accountWithAdmin(9006, "has9006@example.com", "has9006b@example.com"); // an account appears meanwhile
      expect((await (await reviewApplication(asJson({ action: "approve", applicationId: a.applicationId }, platformToken))).json()).code).toBe("account-exists");

      const b = await apply("unver@example.com", "9007");
      await getAdminAuth()!.updateUser(b.uid, { emailVerified: false });
      expect((await (await reviewApplication(asJson({ action: "approve", applicationId: b.applicationId }, platformToken))).json()).code).toBe("email-unverified");
    });

    it("reject needs a reason the applicant can read; block can end an application and stops reuse; notes stay in the private doc", async () => {
      const { token: platformToken } = await platformOwner();
      const a = await apply("rej@example.com", "9008");
      expect((await (await reviewApplication(asJson({ action: "reject", applicationId: a.applicationId, reason: " " }, platformToken))).json()).code).toBe("reason-required");
      expect((await reviewApplication(asJson({ action: "reject", applicationId: a.applicationId, reason: "We couldn't match you to this team." }, platformToken))).status).toBe(200);
      expect(await docData(`teamApplications/${a.applicationId}`)).toMatchObject({ status: "rejected", rejectionReason: "We couldn't match you to this team." });

      const b = await apply("blk@example.com", "9009");
      expect((await (await reviewApplication(asJson({ action: "block", applicationId: b.applicationId, blockEmail: false, blockTeam: false }, platformToken))).json()).code).toBe("nothing-to-block");
      expect((await reviewApplication(asJson({ action: "block", applicationId: b.applicationId, blockTeam: true, blockEmail: false, reason: "not a real team" }, platformToken))).status).toBe(200);
      expect(await docData(`teamApplications/${b.applicationId}`)).toMatchObject({ status: "blocked" });
      expect((await docData("applicationBlocks/team_9009"))?.type).toBe("team");

      expect((await reviewApplication(asJson({ action: "note", applicationId: b.applicationId, notes: "  looked up their website: nothing  " }, platformToken))).status).toBe(200);
      expect((await docData(`applicationPrivate/${b.applicationId}`))?.notes).toBe("looked up their website: nothing");
      expect(JSON.stringify(await docData(`teamApplications/${b.applicationId}`))).not.toContain("looked up");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("POST /api/team/transfer (ownership transfer)", () => {
    const request = (token: string, toUid: string, confirm: string) => transfer(asJson({ action: "request", toUid, confirm }, token));
    const respondAs = async (email: string, action: "accept" | "decline" | "cancel") => transfer(asJson({ action }, await freshToken(email)));

    it("happy path: request, accept: ownerUid moves in a transaction; the old owner stays an admin and loses the protections; the new owner gains them; both are audited", async () => {
      const { teamId, creatorUid, adminUid } = await accountWithAdmin(70, "own70@example.com", "adm70@example.com");
      const requested = await request(await freshToken("own70@example.com"), adminUid, "70");
      expect(requested.status).toBe(200);
      const pending = (await docData(`teams/${teamId}`))!.pendingTransfer;
      expect(pending).toMatchObject({ fromUid: creatorUid, toUid: adminUid });
      expect(pending.expiresAt.toMillis() - pending.requestedAt.toMillis()).toBe(7 * 86_400_000);
      expect((await docData(`teams/${teamId}`))!.ownerUid).toBe(creatorUid); // nothing moves until accepted

      const accepted = await respondAs("adm70@example.com", "accept");
      expect(accepted.status).toBe(200);
      const team = (await docData(`teams/${teamId}`))!;
      expect(team.ownerUid).toBe(adminUid);
      expect(team.pendingTransfer).toBeUndefined();
      expect(await docData(`users/${creatorUid}`)).toMatchObject({ isOwner: false, isAdmin: true });
      expect(await docData(`users/${adminUid}`)).toMatchObject({ isOwner: true, isAdmin: true });
      const actions = (await getAdminFirestore()!.collection("auditLog").where("teamId", "==", teamId).get()).docs.map((d) => d.data().action).sort();
      expect(actions).toEqual(["request-ownership-transfer", "transfer-ownership"]);
    });

    it("the recipient can decline; the owner (or the requester) can cancel; nobody else can", async () => {
      const { teamId, adminUid } = await accountWithAdmin(71, "own71@example.com", "adm71@example.com");
      const ownerToken = async () => freshToken("own71@example.com");
      await request(await ownerToken(), adminUid, "71");
      const declined = await respondAs("adm71@example.com", "decline");
      expect(declined.status).toBe(200);
      expect((await docData(`teams/${teamId}`))!.pendingTransfer).toBeUndefined();
      expect((await docData(`teams/${teamId}`))!.ownerUid).not.toBe(adminUid);

      await request(await ownerToken(), adminUid, "71");
      // a bystander admin who isn't the owner, requester or recipient can't cancel
      const bystander = await createTestUser("by71@example.com", { verified: true });
      await joinTeam(postJson({ joinCode: (await docData(`teams/${teamId}`))!.joinCode, name: "By" }, bystander));
      await getAdminFirestore()!.collection("users").doc(await uidOfEmail("by71@example.com")).update({ isAdmin: true });
      expect((await respondAs("by71@example.com", "cancel")).status).toBe(403);
      expect((await respondAs("own71@example.com", "cancel")).status).toBe(200);
      expect((await docData(`teams/${teamId}`))!.pendingTransfer).toBeUndefined();
      expect((await respondAs("own71@example.com", "cancel")).status).toBe(409); // nothing left to cancel
    });

    it("a request needs the owner, an admin recipient with a verified email, the typed team number, and nothing already pending", async () => {
      const { teamId, creatorUid, adminUid } = await accountWithAdmin(72, "own72@example.com", "adm72@example.com");
      const ownerToken = await freshToken("own72@example.com");
      // a non-owner (even an admin) can't initiate
      const byAdmin = await request(await freshToken("adm72@example.com"), creatorUid, "72");
      expect(byAdmin.status).toBe(403);
      expect((await byAdmin.json()).code).toBe("not-owner");
      // the recipient must be an admin
      const member = await createTestUser("mem72@example.com", { verified: true });
      await joinTeam(postJson({ joinCode: (await docData(`teams/${teamId}`))!.joinCode, name: "Mem" }, member));
      const memberUid = await uidOfEmail("mem72@example.com");
      expect((await (await request(ownerToken, memberUid, "72")).json()).code).toBe("not-admin");
      // ...with a verified email
      await getAdminAuth()!.updateUser(adminUid, { emailVerified: false });
      expect((await (await request(ownerToken, adminUid, "72")).json()).code).toBe("unverified-email");
      await getAdminAuth()!.updateUser(adminUid, { emailVerified: true });
      // the typed number must match
      expect((await (await request(ownerToken, adminUid, "73")).json()).code).toBe("bad-confirmation");
      expect((await (await request(ownerToken, adminUid, "")).json()).code).toBe("bad-confirmation");
      // someone outside the team
      const outsider = await createTestUser("out72@example.com", { verified: true });
      void outsider;
      expect((await (await request(ownerToken, await uidOfEmail("out72@example.com"), "72")).json()).code).toBe("no-target");
      // yourself
      expect((await (await request(ownerToken, creatorUid, "72")).json()).code).toBe("self");
      // finally ok, and then only one at a time
      expect((await request(ownerToken, adminUid, "72")).status).toBe(200);
      expect((await (await request(ownerToken, adminUid, "72")).json()).code).toBe("pending-exists");
    });

    it("expires after 7 days: it can't be accepted, and a new request replaces it", async () => {
      const { teamId, adminUid } = await accountWithAdmin(74, "own74@example.com", "adm74@example.com");
      await request(await freshToken("own74@example.com"), adminUid, "74");
      const db = getAdminFirestore()!;
      const pending = (await docData(`teams/${teamId}`))!.pendingTransfer;
      await db.collection("teams").doc(teamId).update({ "pendingTransfer.expiresAt": new Date(Date.now() - 1000), "pendingTransfer.requestedAt": new Date(Date.now() - 8 * 86_400_000) });
      void pending;
      const late = await respondAs("adm74@example.com", "accept");
      expect(late.status).toBe(409);
      expect((await late.json()).code).toBe("expired");
      expect((await docData(`teams/${teamId}`))!.ownerUid).not.toBe(adminUid);
      // the owner can simply ask again
      expect((await request(await freshToken("own74@example.com"), adminUid, "74")).status).toBe(200);
      expect((await respondAs("adm74@example.com", "accept")).status).toBe(200);
    });

    it("only the named recipient can accept, and only while they're still an admin with a verified email", async () => {
      const { teamId, adminUid } = await accountWithAdmin(75, "own75@example.com", "adm75@example.com");
      await request(await freshToken("own75@example.com"), adminUid, "75");
      expect((await respondAs("own75@example.com", "accept")).status).toBe(403); // not addressed to the owner
      await getAdminFirestore()!.collection("users").doc(adminUid).update({ isAdmin: false });
      expect((await (await respondAs("adm75@example.com", "accept")).json()).code).toBe("recipient-not-admin");
      await getAdminFirestore()!.collection("users").doc(adminUid).update({ isAdmin: true });
      expect((await respondAs("adm75@example.com", "accept")).status).toBe(200);
      expect((await docData(`teams/${teamId}`))!.ownerUid).toBe(adminUid);
    });

    it("a request voided by a recovery transfer in between can't be accepted afterwards", async () => {
      const { teamId, creatorUid, adminUid } = await accountWithAdmin(76, "own76@example.com", "adm76@example.com");
      await request(await freshToken("own76@example.com"), adminUid, "76");
      // the ownership changes underneath it (as a force-transfer would do, which also clears the pending record)
      const db = getAdminFirestore()!;
      await db.collection("teams").doc(teamId).update({ ownerUid: "someone-else" });
      expect((await (await respondAs("adm76@example.com", "accept")).json()).code).toBe("stale");
      expect((await docData(`teams/${teamId}`))!.ownerUid).toBe("someone-else");
      void creatorUid;
    });

    it("a platform owner can force a recovery transfer of any account (reason, recent sign-in and typed number required); it is labelled and logged twice; nobody else can", async () => {
      const { teamId, creatorUid, adminUid } = await accountWithAdmin(77, "own77@example.com", "adm77@example.com");
      const { token: platformToken, uid: platformUid } = await platformOwner();
      const force = (token: string, over: Record<string, unknown> = {}) => transfer(asJson({ action: "force", teamId, toUid: adminUid, confirm: "77", reason: "The owner graduated and can't be reached.", ...over }, token));

      expect((await force(await freshToken("own77@example.com"))).status).toBe(403); // the team's own owner has no force power
      expect((await (await force(platformToken, { reason: "" })).json()).code).toBe("reason-required");
      expect((await (await force(platformToken, { confirm: "1" })).json()).code).toBe("bad-confirmation");
      expect((await (await force(platformToken, { toUid: "nobody" })).json()).code).toBe("no-target");

      // a pending request by the old owner is voided by it
      await request(await freshToken("own77@example.com"), adminUid, "77");
      const done = await force(await freshToken("owner@example.com"));
      expect(done.status).toBe(200);
      const team = (await docData(`teams/${teamId}`))!;
      expect(team.ownerUid).toBe(adminUid);
      expect(team.pendingTransfer).toBeUndefined();
      expect(await docData(`users/${creatorUid}`)).toMatchObject({ isOwner: false, isAdmin: true });
      expect(await docData(`users/${adminUid}`)).toMatchObject({ isOwner: true, isAdmin: true });

      const db = getAdminFirestore()!;
      const teamLog = (await db.collection("auditLog").where("teamId", "==", teamId).get()).docs.map((d) => d.data()).find((d) => d.action === "force-transfer-ownership")!;
      expect(teamLog.actorName).toContain("platform owner, recovery");
      expect(teamLog.target.reason).toContain("graduated");
      const platformLog = (await db.collection("platformAuditLog").get()).docs.map((d) => d.data()).find((d) => d.action === "force-transfer-ownership")!;
      expect(platformLog.actorUid).toBe(platformUid);

    });

    it("the recovery list shows accounts' FTC teams, owner and admins only: no join codes, and platform owners only", async () => {
      await accountWithAdmin(78, "own78@example.com", "adm78@example.com");
      const { token } = await platformOwner();
      const res = await listTeams(asGet(token));
      expect(res.status).toBe(200);
      const { teams } = await res.json();
      const t = teams.find((x: { fieldTeams: { number: number }[] }) => x.fieldTeams[0]?.number === 78);
      expect(t.admins.map((a: { email: string }) => a.email).sort()).toEqual(["adm78@example.com", "own78@example.com"]);
      expect(t.ownerName).toBe("Creator");
      // no joinCode key, and none of the real join codes anywhere (matching a 6-character pattern would also hit the random 20-character team ids now and then)
      const allCodes = (await getAdminFirestore()!.collection("teams").get()).docs.map((d) => d.data().joinCode as string).filter(Boolean);
      expect(allCodes.length).toBeGreaterThan(0);
      expect(JSON.stringify(teams)).not.toContain("joinCode");
      for (const code of allCodes) expect(JSON.stringify(teams)).not.toContain(`"${code}"`);
      expect((await listTeams(asGet(await freshToken("own78@example.com")))).status).toBe(403);
      expect((await listTeams(asGet())).status).toBe(401);
    });
  });
});

// the route's JSON answers and the stored documents are read loosely in these tests
/* eslint-disable @typescript-eslint/no-explicit-any */
describe("P23 templates", () => {
  const templates = templatesRoute;
  const build = templateLib.buildTemplateContent;
  const blankForm = formLib.createBlankForm;

  let team = 100;
  const fresh = async (email: string) => {
    await signInWithEmailAndPassword(clientAuth, email, "password123");
    return clientAuth.currentUser!.getIdToken(true);
  };
  const call = async (body: Record<string, unknown>, token?: string) => {
    const res = await templates(postJson(body, token));
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const doc = async (path: string) => (await getAdminFirestore()!.doc(path).get()).data();
  const openCreation = () => getAdminFirestore()!.doc("appSettings/global").set({ teamCreationEnabled: true });

  /** A team account whose creator is its owner and admin, plus a plain scout member. */
  async function account(creatorEmail: string, scoutEmail?: string) {
    const creator = await createTestUser(creatorEmail, { verified: true });
    await openCreation();
    const { teamId, joinCode } = await (await createTeam(postJson({ teamNumber: team++, teamName: "T", name: `Creator ${team}` }, creator))).json();
    let scoutToken: string | undefined;
    if (scoutEmail) {
      scoutToken = await createTestUser(scoutEmail, { verified: true });
      await joinTeam(postJson({ joinCode, name: "Scout" }, scoutToken));
    }
    return { teamId, token: await fresh(creatorEmail), scoutToken: scoutEmail ? await fresh(scoutEmail) : undefined };
  }

  async function platformOwner() {
    const first = await createTestUser("owner@example.com", { verified: true });
    await openCreation();
    const { teamId } = await (await createTeam(postJson({ teamNumber: 1, teamName: "Platform", name: "Pat" }, first))).json();
    await syncRoles(postJson({}, first));
    return { teamId, token: await fresh("owner@example.com") };
  }

  /** What a client write leaves behind: a private template of `teamId`. */
  async function seed(id: string, teamId: string, over: Record<string, unknown> = {}, formOver?: (f: ReturnType<typeof blankForm>) => ReturnType<typeof blankForm>) {
    const base = { ...blankForm({ id: "pit", name: "Pit", createdBy: "u" }), scoringEnabled: false };
    const built = build({ form: formOver ? formOver(base) : base, name: "Pit scouting", description: "Robot inspection", tags: ["pit"] });
    if (!built.ok) throw new Error(built.errors.join());
    await getAdminFirestore()!.doc(`formTemplates/${id}`).set({ ownerTeamId: teamId, authorName: "Team", visibility: "private", official: false, version: 1, importCount: 0, reportCount: 0, createdAt: 1, updatedAt: 1, ...built.content, ...over });
  }

  const audit = async (teamId: string) => (await getAdminFirestore()!.collection("auditLog").where("teamId", "==", teamId).get()).docs.map((d) => d.data().action as string);

  describe("asking to publish", () => {
    it("moves a private template to review for its owner and admins only, and logs it in the account's audit log", async () => {
      const a = await account("a-owner@example.com", "a-scout@example.com");
      await seed("t1", a.teamId);
      expect((await call({ action: "request-publish", id: "t1" }, a.scoutToken)).status).toBe(403); // a scout can't
      expect((await call({ action: "request-publish", id: "t1" })).status).toBe(401);
      const other = await account("b-owner@example.com");
      expect((await call({ action: "request-publish", id: "t1" }, other.token)).status).toBe(403); // not their template
      const ok = await call({ action: "request-publish", id: "t1" }, a.token);
      expect(ok.status).toBe(200);
      expect(await doc("formTemplates/t1")).toMatchObject({ visibility: "public-pending" });
      expect(await audit(a.teamId)).toContain("request-template-publish");
      expect((await call({ action: "request-publish", id: "t1" }, a.token)).body.code).toBe("wrong-state");
    });

    it("re-validates on the server: a tampered checksum or HTML in the text is refused", async () => {
      const a = await account("c-owner@example.com");
      await seed("bad-sum", a.teamId, { checksum: "0000000000000000" });
      expect((await call({ action: "request-publish", id: "bad-sum" }, a.token)).body.code).toBe("damaged");
      // HTML smuggled into a stored template (a client can write private templates directly): the checksum is right, the text is not clean
      const { formChecksum } = portableLib;
      const dirty = portableLib.exportForm({ ...blankForm({ id: "pit", name: "Pit", createdBy: "" }), scoringEnabled: false, description: "A <b>pit</b> form" }).form;
      await getAdminFirestore()!.doc("formTemplates/dirty").set({ ownerTeamId: a.teamId, authorName: "T", visibility: "private", official: false, version: 1, importCount: 0, reportCount: 0, name: "Dirty", description: "d", tags: [], form: dirty, checksum: formChecksum(dirty), fieldCount: 1, sectionCount: 5 });
      expect((await call({ action: "request-publish", id: "dirty" }, a.token)).body.code).toBe("unsafe-text");
      // a form with a blocking problem (scoring on, nothing scores)
      const broken = portableLib.exportForm({ ...blankForm({ id: "pit", name: "Pit", createdBy: "" }), scoringEnabled: true }).form; // building one is refused, but a client can write a private template directly
      await getAdminFirestore()!.doc("formTemplates/broken").set({ ownerTeamId: a.teamId, authorName: "T", visibility: "private", official: false, version: 1, importCount: 0, reportCount: 0, name: "Broken", description: "d", tags: [], form: broken, checksum: formChecksum(broken), fieldCount: 1, sectionCount: 5 });
      expect((await call({ action: "request-publish", id: "broken" }, a.token)).body.code).toBe("invalid-template");
    });

    it("limits requests to 3 an hour and 5 waiting per account", async () => {
      const a = await account("d-owner@example.com");
      for (let i = 0; i < 4; i++) await seed(`r${i}`, a.teamId);
      for (let i = 0; i < 3; i++) expect((await call({ action: "request-publish", id: `r${i}` }, a.token)).status).toBe(200);
      const fourth = await call({ action: "request-publish", id: "r3" }, a.token);
      expect(fourth.status).toBe(429);
      expect(fourth.body.code).toBe("rate-limited");

      const b = await account("e-owner@example.com");
      for (let i = 0; i < 5; i++) await seed(`w${i}`, b.teamId, { visibility: "public-pending" });
      await seed("one-more", b.teamId);
      const capped = await call({ action: "request-publish", id: "one-more" }, b.token);
      expect(capped.status).toBe(429);
      expect(capped.body.code).toBe("pending-cap");
    });
  });

  describe("review", () => {
    it("only the platform owner approves; an approved template is public and its author is told in the audit log", async () => {
      const a = await account("f-owner@example.com");
      const p = await platformOwner();
      await seed("t1", a.teamId);
      await call({ action: "request-publish", id: "t1" }, a.token);
      expect((await call({ action: "approve", id: "t1" }, a.token)).status).toBe(403);
      expect((await call({ action: "approve", id: "t1" })).status).toBe(401);
      expect((await call({ action: "approve", id: "t1" }, p.token)).status).toBe(200);
      expect(await doc("formTemplates/t1")).toMatchObject({ visibility: "public" });
      expect(await audit(a.teamId)).toContain("template-reviewed");
      expect((await getAdminFirestore()!.collection("platformAuditLog").get()).docs.map((d) => d.data().action)).toContain("approve-template");
      expect((await call({ action: "approve", id: "t1" }, p.token)).body.code).toBe("wrong-state");
    });

    it("rejecting needs a reason, sends it back to the author with it, and the author can fix and ask again", async () => {
      const a = await account("g-owner@example.com");
      const p = await platformOwner();
      await seed("t1", a.teamId);
      await call({ action: "request-publish", id: "t1" }, a.token);
      expect((await call({ action: "reject", id: "t1" }, p.token)).body.code).toBe("reason-required");
      expect((await call({ action: "reject", id: "t1", reason: "ok" }, p.token)).status).toBe(400);
      expect((await call({ action: "reject", id: "t1", reason: "Too generic: add scoring" }, p.token)).status).toBe(200);
      expect(await doc("formTemplates/t1")).toMatchObject({ visibility: "rejected", rejectionReason: "Too generic: add scoring" });
      // the author edits (rules allow rejected -> private) and asks again
      await getAdminFirestore()!.doc("formTemplates/t1").update({ visibility: "private" });
      expect((await call({ action: "request-publish", id: "t1" }, a.token)).status).toBe(200);
    });

    it("a platform owner can take a public template down (with a reason), and an author can unpublish their own", async () => {
      const a = await account("h-owner@example.com");
      const p = await platformOwner();
      await seed("t1", a.teamId, { visibility: "public", official: true });
      await seed("t2", a.teamId, { visibility: "public" });
      expect((await call({ action: "take-down", id: "t1", reason: "" }, p.token)).body.code).toBe("reason-required");
      expect((await call({ action: "take-down", id: "t1", reason: "Contains a broken link" }, a.token)).status).toBe(403);
      expect((await call({ action: "take-down", id: "t1", reason: "Contains a broken link" }, p.token)).status).toBe(200);
      expect(await doc("formTemplates/t1")).toMatchObject({ visibility: "rejected", official: false, rejectionReason: "Contains a broken link" });
      expect((await call({ action: "unpublish", id: "t2" }, a.token)).status).toBe(200);
      expect(await doc("formTemplates/t2")).toMatchObject({ visibility: "private" });
      expect(await audit(a.teamId)).toEqual(expect.arrayContaining(["unpublish-template", "template-reviewed"]));
      const b = await account("i-owner@example.com");
      await seed("t3", a.teamId, { visibility: "public" });
      expect((await call({ action: "unpublish", id: "t3" }, b.token)).status).toBe(403);
    });

    it("only the platform owner marks a public template official", async () => {
      const a = await account("j-owner@example.com");
      const p = await platformOwner();
      await seed("pub", a.teamId, { visibility: "public" });
      await seed("priv", a.teamId);
      expect((await call({ action: "set-official", id: "pub", official: true }, a.token)).status).toBe(403);
      expect((await call({ action: "set-official", id: "priv", official: true }, p.token)).body.code).toBe("wrong-state");
      expect((await call({ action: "set-official", id: "pub", official: true }, p.token)).status).toBe(200);
      expect(await doc("formTemplates/pub")).toMatchObject({ official: true });
    });
  });

  describe("updating a public template", () => {
    it("holds the new version for review while the approved one stays live, then promotes or discards it", async () => {
      const a = await account("k-owner@example.com");
      const p = await platformOwner();
      await seed("pub", a.teamId, { visibility: "public", publishedAt: 5 });
      const current = (await doc("formTemplates/pub"))!.form;
      const next = { ...current, sections: current.sections.map((s: any) => (s.id === "misc" ? { ...s, title: "Extras" } : s)) };
      const sent = await call({ action: "update-public", id: "pub", form: next, name: "Pit scouting v2" }, a.token);
      expect(sent.status).toBe(200);
      expect(sent.body.pendingVersion).toBe(2);
      expect(await doc("formTemplates/pub")).toMatchObject({ version: 1, name: "Pit scouting", hasPendingUpdate: true });
      expect(await doc("formTemplates/pub/updates/pending")).toMatchObject({ version: 2, name: "Pit scouting v2" });
      expect((await call({ action: "update-public", id: "pub" }, a.token)).body.code).toBe("no-change"); // nothing new
      expect((await call({ action: "approve", id: "pub" }, p.token)).status).toBe(200);
      const after = await doc("formTemplates/pub");
      expect(after).toMatchObject({ version: 2, name: "Pit scouting v2", visibility: "public" });
      expect(after?.hasPendingUpdate).toBeUndefined();
      expect(after?.form.sections.some((s: any) => s.title === "Extras")).toBe(true);
      expect(await doc("formTemplates/pub/updates/pending")).toBeUndefined();

      const again = { ...next, sections: next.sections.map((s: any) => (s.id === "misc" ? { ...s, title: "Other" } : s)) };
      await call({ action: "update-public", id: "pub", form: again }, a.token);
      expect((await call({ action: "reject", id: "pub", reason: "Not an improvement" }, p.token)).body.decision).toBe("update-rejected");
      expect(await doc("formTemplates/pub")).toMatchObject({ version: 2, visibility: "public" });
      expect((await doc("formTemplates/pub"))?.hasPendingUpdate).toBeUndefined();
    });

    it("validates the new version like a new template, and only its author can send one", async () => {
      const a = await account("l-owner@example.com");
      const b = await account("m-owner@example.com");
      await seed("pub", a.teamId, { visibility: "public" });
      const current = (await doc("formTemplates/pub"))!.form;
      const bad = { ...current, sections: current.sections.map((s: any) => ({ ...s, fields: s.fields.map((f: any) => ({ ...f, type: f.type === "textarea" ? "hologram" : f.type })) })) };
      expect((await call({ action: "update-public", id: "pub", form: bad }, a.token)).body.code).toBe("invalid-template");
      expect((await call({ action: "update-public", id: "pub", name: "Mine now" }, b.token)).status).toBe(403);
      await seed("priv", a.teamId);
      expect((await call({ action: "update-public", id: "priv", name: "x" }, a.token)).body.code).toBe("wrong-state");
    });
  });

  describe("using, counting and reporting", () => {
    it("returns a public template to any account and counts each account once; the author's own use isn't counted", async () => {
      const a = await account("n-owner@example.com");
      const b = await account("o-owner@example.com");
      await seed("pub", a.teamId, { visibility: "public" });
      const first = await call({ action: "import", id: "pub" }, b.token);
      expect(first.status).toBe(200);
      expect(first.body.template).toMatchObject({ id: "pub", version: 1, name: "Pit scouting" });
      expect(first.body.template.form.sections).toHaveLength(5);
      await call({ action: "import", id: "pub" }, b.token);
      await call({ action: "import", id: "pub" }, a.token);
      expect(await doc("formTemplates/pub")).toMatchObject({ importCount: 1 });
      const c = await account("p-owner@example.com");
      await call({ action: "import", id: "pub" }, c.token);
      expect(await doc("formTemplates/pub")).toMatchObject({ importCount: 2 });
    });

    it("never returns a private, pending or rejected template to another account, but does to its own", async () => {
      const a = await account("q-owner@example.com");
      const b = await account("r-owner@example.com");
      for (const [id, visibility] of [["pr", "private"], ["pe", "public-pending"], ["re", "rejected"]] as const) {
        await seed(id, a.teamId, { visibility });
        expect((await call({ action: "import", id }, b.token)).status).toBe(403);
        expect((await call({ action: "import", id }, a.token)).status).toBe(200);
      }
      expect(await doc("formTemplates/pr")).toMatchObject({ importCount: 0 });
      expect((await call({ action: "import", id: "nope" }, a.token)).status).toBe(404);
    });

    it("lets another account report a public template once, never its own, with a reason; the platform owner can dismiss them", async () => {
      const a = await account("s-owner@example.com");
      const b = await account("t-owner@example.com", "t-scout@example.com");
      const p = await platformOwner();
      await seed("pub", a.teamId, { visibility: "public" });
      expect((await call({ action: "report", id: "pub", reason: "Spam" }, a.token)).body.code).toBe("own-template");
      expect((await call({ action: "report", id: "pub", reason: "Spam" }, b.scoutToken)).status).toBe(403);
      expect((await call({ action: "report", id: "pub", reason: "" }, b.token)).body.code).toBe("reason-required");
      expect((await call({ action: "report", id: "pub", reason: "Links to a bad site <script>" }, b.token)).status).toBe(200);
      expect((await call({ action: "report", id: "pub", reason: "Again" }, b.token)).body.code).toBe("already-reported");
      expect(await doc("formTemplates/pub")).toMatchObject({ reportCount: 1 });
      expect((await doc(`formTemplates/pub/reports/${b.teamId}`))?.reason).toBe("Links to a bad site");
      await seed("priv", a.teamId);
      expect((await call({ action: "report", id: "priv", reason: "x y z" }, b.token)).body.code).toBe("wrong-state");
      expect((await call({ action: "dismiss-reports", id: "pub" }, b.token)).status).toBe(403);
      expect((await call({ action: "dismiss-reports", id: "pub" }, p.token)).body.dismissed).toBe(1);
      expect(await doc("formTemplates/pub")).toMatchObject({ reportCount: 0 });
    });
  });

  describe("official templates", () => {
    it("seeds the official templates once, for the platform owner only, and adds a version when the content changes", async () => {
      const a = await account("u-owner@example.com");
      const p = await platformOwner();
      expect((await call({ action: "seed-official" }, a.token)).status).toBe(403);
      const first = await call({ action: "seed-official" }, p.token);
      // BIOBUZZ, the Blank starter and (P28) the Lead Scout, Match Strategy and Drive Reflection forms
      expect(first.body.results).toEqual(["official-biobuzz", "official-blank", "official-lead-scout", "official-match-strategy", "official-drive-reflection", "official-pit-scout", "official-team-strategy", "official-helper"].map((id) => ({ id, result: "created" })));
      expect(await doc("formTemplates/official-biobuzz")).toMatchObject({ visibility: "public", official: true, version: 1, authorName: "CompEpicurus", importCount: 0 });
      expect((await doc("formTemplates/official-blank"))?.form.sections.map((s: any) => s.title)).toEqual(["Pre-Match", "Autonomous", "Teleoperated", "Endgame", "Misc"]);
      expect((await call({ action: "seed-official" }, p.token)).body.results.every((r: any) => r.result === "unchanged")).toBe(true);

      await call({ action: "import", id: "official-biobuzz" }, a.token);
      await getAdminFirestore()!.doc("formTemplates/official-biobuzz").update({ checksum: "stale" }); // the code-defined content moved on
      const again = await call({ action: "seed-official" }, p.token);
      expect(again.body.results[0]).toEqual({ id: "official-biobuzz", result: "updated" });
      expect(await doc("formTemplates/official-biobuzz")).toMatchObject({ version: 2, importCount: 1, official: true });
    });
  });

  it("refuses the unknown, the unsigned and the oversized", async () => {
    const a = await account("v-owner@example.com");
    expect((await call({ action: "nope" }, a.token)).status).toBe(400);
    expect((await call({ action: "approve", id: "x" })).status).toBe(401);
    const big = await templates(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ action: "update-public", id: "x", pad: "x".repeat(400_000) }) }));
    expect(big.status).toBe(413);
  });
});

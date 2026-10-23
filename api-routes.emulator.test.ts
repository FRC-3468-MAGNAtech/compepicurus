import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from "firebase/auth";
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

const PROJECT_ID = "compepicurus-api-test";

// The Admin SDK only needs *shaped* credentials to construct a client when
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST redirect every call
// to the local emulators — neither emulator validates them.
process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT_ID;
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_ADMIN_PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAq8YYlFX/qvzYcVqz\n-----END PRIVATE KEY-----\n";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.OWNER_EMAILS = "owner@example.com";
process.env.ADMIN_EMAILS = "preset-admin@example.com";

const { POST: createTeam } = await import("@/app/api/team/create/route");
const { POST: joinTeam } = await import("@/app/api/team/join/route");
const { POST: syncRoles } = await import("@/app/api/auth/sync-roles/route");
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

    const adminAuth = getAdminAuth()!;
    const record = await adminAuth.getUserByEmail("owner@example.com");
    expect(record.customClaims?.owner).toBeFalsy();
  });

  it("grants owner + admin, and sets custom claims, for a verified OWNER_EMAILS match", async () => {
    const idToken = await createTestUser("owner@example.com", { verified: true });
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

import "server-only";
import { cert, getApps, getApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

// Server-only counterpart to lib/firebase/client.ts. Used by app/api/auth/session
// (to mint/verify session cookies) and lib/server/require-user.ts (to verify
// them on every FIRST API proxy call). Never import this from a client
// component — the "server-only" import above throws at build time if you try.

function getServiceAccount() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // Vercel's env var UI (and most dashboards) can't store a literal newline
  // in a single-line value, so the private key is pasted with escaped `\n`
  // sequences and un-escaped here. See docs/DEPLOYMENT.md.
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "FIREBASE_ADMIN_* missing:",
      JSON.stringify({ projectId: !!projectId, clientEmail: !!clientEmail, privateKey: !!privateKey })
    );
    return null;
  }
  // A value pasted straight from the downloaded JSON file (quotes included)
  // or wrapped in quotes by a dashboard's env var UI leaves literal `"` at
  // each end, which breaks PEM parsing below in a way that's easy to miss
  // by eye — strip it defensively and log when this was needed.
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    console.error("FIREBASE_ADMIN_PRIVATE_KEY was wrapped in literal quotes — stripping them.");
    privateKey = privateKey.slice(1, -1);
  }
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    console.error(
      `FIREBASE_ADMIN_PRIVATE_KEY doesn't look like a PEM key after un-escaping (length ${privateKey.length}, no "BEGIN PRIVATE KEY" marker) — check it was pasted with literal \\n sequences, not real line breaks, and without surrounding quotes. See docs/DEPLOYMENT.md.`
    );
  }
  return { projectId, clientEmail, privateKey };
}

export function isFirebaseAdminConfigured(): boolean {
  return getServiceAccount() !== null;
}

let app: App | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let messagingInstance: Messaging | null = null;

function getAdminApp(): App | null {
  if (app) return app;
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) return null;
  try {
    app = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) });
    return app;
  } catch (err) {
    // Without this, a malformed key throws here uncaught — every caller
    // (API routes that call getAdminFirestore()/getAdminAuth() with no
    // try/catch of their own) would 500 instead of failing closed the same
    // way "env vars missing" already does. Logged so the actual cause shows
    // up in Vercel's Function Logs instead of just "team creation disabled."
    console.error("Firebase Admin SDK failed to initialize:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Null when FIREBASE_ADMIN_* env vars aren't configured — callers (lib/server/require-user.ts) treat that as "nobody can be verified yet," not a crash. */
export function getAdminAuth(): Auth | null {
  if (authInstance) return authInstance;
  const adminApp = getAdminApp();
  if (!adminApp) return null;
  authInstance = getAuth(adminApp);
  return authInstance;
}

/** Firestore via the Admin SDK — bypasses security rules entirely, used only from trusted API routes (team creation/join, role sync, the owner-only settings toggle). Null when unconfigured, same convention as getAdminAuth(). */
export function getAdminFirestore(): Firestore | null {
  if (firestoreInstance) return firestoreInstance;
  const adminApp = getAdminApp();
  if (!adminApp) return null;
  firestoreInstance = getFirestore(adminApp);
  return firestoreInstance;
}

/** P7: sends web push for live-score-ready notifications (app/api/cron/poll-live-scores, app/api/live/check-scores). Null when unconfigured, same convention as the others. */
export function getAdminMessaging(): Messaging | null {
  if (messagingInstance) return messagingInstance;
  const adminApp = getAdminApp();
  if (!adminApp) return null;
  messagingInstance = getMessaging(adminApp);
  return messagingInstance;
}

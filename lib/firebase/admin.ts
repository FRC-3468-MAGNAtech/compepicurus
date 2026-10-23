import "server-only";
import { cert, getApps, getApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

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
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function isFirebaseAdminConfigured(): boolean {
  return getServiceAccount() !== null;
}

let app: App | null = null;
let authInstance: Auth | null = null;

function getAdminApp(): App | null {
  if (app) return app;
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) return null;
  app = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) });
  return app;
}

/** Null when FIREBASE_ADMIN_* env vars aren't configured — callers (lib/server/require-user.ts) treat that as "nobody can be verified yet," not a crash. */
export function getAdminAuth(): Auth | null {
  if (authInstance) return authInstance;
  const adminApp = getAdminApp();
  if (!adminApp) return null;
  authInstance = getAuth(adminApp);
  return authInstance;
}

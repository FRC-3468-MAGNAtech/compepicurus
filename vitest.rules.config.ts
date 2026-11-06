import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate from vitest.config.ts (which excludes these files) because both
// need the Firebase Emulator Suite (Auth + Firestore) running — see
// package.json's test:rules script and docs/ASSUMPTIONS.md (unverified in
// this environment: no Java / firebase-tools available here).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // The API-route tests import real server modules, which `import "server-only"`.
      "server-only": path.resolve(__dirname, "test-stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["firestore.rules.test.ts", "api-routes.emulator.test.ts"],
    // One file at a time: both talk to the same emulators, and the API-route tests wipe Auth/Firestore
    // between cases while the rules tests run heavily concurrent transactions (the P12 pick-list ones),
    // which starved each other when the two files ran in parallel (FIX2).
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});

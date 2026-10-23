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
    },
  },
  test: {
    environment: "node",
    include: ["firestore.rules.test.ts", "api-routes.emulator.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});

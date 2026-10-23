import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts (which excludes this file) because these
// tests need the Firebase emulators running — see package.json's test:rules
// script and docs/ASSUMPTIONS.md (unverified in this environment: no Java /
// firebase-tools available here).
export default defineConfig({
  test: {
    environment: "node",
    include: ["firestore.rules.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Component tests import modules that reach server code (e.g. the FIRST API actions), which `import "server-only"`.
      "server-only": path.resolve(__dirname, "test-stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    exclude: ["node_modules/**", ".next/**", "**/*.rules.test.ts", "**/*.emulator.test.ts"],
  },
});

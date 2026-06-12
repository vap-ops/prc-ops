import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      LINE_CHANNEL_ID: "test-line-channel-id",
      LINE_CHANNEL_SECRET: "test-line-channel-secret",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    },
    // Spike tests are excluded by design: they validate one-time questions,
    // require gitignored fixtures, and must not run in CI on every future PR.
    // The include patterns below are sufficient — spikes/ is simply not listed.
    // Run spike tests manually with: pnpm spike:test
    include: [
      "tests/unit/**/*.{test,spec}.{ts,tsx}",
      "tests/integration/**/*.{test,spec}.{ts,tsx}",
    ],
    coverage: {
      reporter: ["text", "lcov"],
      exclude: ["node_modules/", "src/test/"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // Neutralize the server-only poison once for the whole suite
      // (spec 65) — replaces the 14 per-file vi.mock("server-only") lines.
      "server-only": resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});

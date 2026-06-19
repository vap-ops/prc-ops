// Spike 02 — Playwright globalSetup. Runs once before the test.
//
// Loads real Supabase creds from .env.local (Playwright does NOT auto-load it),
// ensures the marked test super_admin exists, mints a session, and writes the
// storageState the test consumes. Fails LOUD with an actionable message if the
// creds are missing/placeholder — that is the difference between "this machine
// has no creds" and "the mechanism is broken".

import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ensureTestSuperAdmin,
  mintStorageState,
  readSpikeEnv,
  TEST_SUPER_EMAIL,
} from "./seed-session";

// Run command is documented as `npx playwright test --config
// spikes/02-authed-e2e/playwright.config.ts` from the repo root, so cwd is root.
export const STORAGE_STATE_PATH = resolve(
  process.cwd(),
  "spikes/02-authed-e2e/.auth/super.json",
);

/** Minimal .env.local parser — avoids adding a dotenv dependency for a spike. */
function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return out; // absent -> rely on process.env; readSpikeEnv will complain
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export default async function globalSetup(): Promise<void> {
  // process.env (e.g. CI secrets injected at runtime) wins over the file.
  const env = readSpikeEnv({ ...loadEnvLocal(), ...process.env });

  await ensureTestSuperAdmin(env);
  const state = await mintStorageState(env);

  mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true });
  writeFileSync(STORAGE_STATE_PATH, JSON.stringify(state, null, 2));

  console.log(
    `[spike-02] storageState for ${TEST_SUPER_EMAIL} -> ${STORAGE_STATE_PATH} ` +
      `(${state.cookies.length} cookie(s): ${state.cookies.map((c) => c.name).join(", ")})`,
  );
}

// Spike 02 — authenticated-session minting for Playwright.
//
// LOCAL-ONLY. Never import this from anything that reaches the app bundle.
// It reads the service-role key and talks to the Supabase admin API.
//
// Mechanism (mirrors ADR 0012's proven prod LINE flow, minus LINE):
//   1. Ensure ONE clearly-marked test user exists and is super_admin
//      (admin client bypasses RLS; idempotent).
//   2. admin.generateLink({ type: "magiclink" }) -> a one-time hashed_token.
//   3. An in-memory @supabase/ssr server client calls verifyOtp(hashed_token).
//      That call makes the ssr client WRITE the real session cookies into a
//      cookie jar we control (same code path the app uses).
//   4. We hand those exact cookies to Playwright as a storageState, retargeted
//      at the app origin (localhost). This is the "cookie-injection" approach:
//      no new app route, no production surface.
//
// Why cookie-injection and not a hand-built cookie: @supabase/ssr 0.10.2 owns
// the cookie name (`sb-<ref>-auth-token`), the `base64-` + base64url encoding,
// and the >3180-byte chunking (see README). Letting the library write the
// cookie means we never reproduce that encoding by hand — it is correct by
// construction and stays correct if the library changes it.

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";

/** Clearly-marked, non-deliverable test identity. Never a real person. */
export const TEST_SUPER_EMAIL = "e2e+super@prc-ops.test";

export interface SpikeEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
  expires: number;
}

export interface StorageState {
  cookies: PlaywrightCookie[];
  origins: never[];
}

// Matches the placeholders this machine's .env.local ships with, and the
// vitest test-env stubs, so a misconfigured run fails LOUD instead of producing
// a confusing "redirected to /login" later.
const PLACEHOLDER = /placeholder|^test-/i;

export function readSpikeEnv(raw: Record<string, string | undefined>): SpikeEnv {
  const url = raw.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = raw.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = raw.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const entries: ReadonlyArray<readonly [string, string]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", url],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
  ];
  for (const [name, value] of entries) {
    if (!value) {
      throw new Error(
        `[spike-02] ${name} is empty. Put REAL Supabase credentials in .env.local. ` +
          `See spikes/02-authed-e2e/README.md ("How to run" + "Open decisions").`,
      );
    }
    if (PLACEHOLDER.test(value)) {
      throw new Error(
        `[spike-02] ${name} looks like a placeholder ("${value.slice(0, 18)}…"). ` +
          `This spike mints a real session against a real project — point .env.local at ` +
          `prod or a preview-branch DB (see README "Open decisions" — which DB e2e runs against).`,
      );
    }
  }
  return { url, anonKey, serviceRoleKey };
}

/** The project ref Supabase derives the cookie name from: `sb-<ref>-auth-token`. */
export function projectRef(url: string): string {
  return new URL(url).hostname.split(".")[0] ?? "";
}

type AdminClient = ReturnType<typeof createClient<Database>>;

function adminClient(env: SpikeEnv): AdminClient {
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Idempotently ensure the marked test user exists and holds super_admin.
 * super_admin is chosen deliberately: per ADR 0056 / spec 143 it sees every
 * project with NO project_members seeding, so the green test needs no fixtures.
 * Returns the auth user id.
 */
export async function ensureTestSuperAdmin(env: SpikeEnv): Promise<string> {
  const admin = adminClient(env);

  // createUser is the idempotent anchor. email_confirm:true because there is
  // nothing to confirm for a synthetic test identity.
  const created = await admin.auth.admin.createUser({
    email: TEST_SUPER_EMAIL,
    email_confirm: true,
    user_metadata: { provider: "e2e-spike", note: "spike-02 throwaway test user" },
  });

  let userId = created.data.user?.id ?? null;
  if (created.error && !/already|exists|registered/i.test(created.error.message)) {
    throw new Error(`[spike-02] createUser failed: ${created.error.message}`);
  }

  // Already-existed branch: recover the id by paging admin.listUsers.
  if (!userId) {
    for (let page = 1; page <= 20 && !userId; page += 1) {
      const list = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (list.error) throw new Error(`[spike-02] listUsers failed: ${list.error.message}`);
      userId = list.data.users.find((u) => u.email === TEST_SUPER_EMAIL)?.id ?? null;
      if (list.data.users.length < 200) break;
    }
  }
  if (!userId) {
    throw new Error(`[spike-02] could not resolve id for ${TEST_SUPER_EMAIL}`);
  }

  // The ADR-0007 trigger created public.users (role visitor). Promote it.
  // Admin client bypasses RLS, so this is a plain UPDATE.
  const promote = await admin
    .from("users")
    .update({ role: "super_admin" })
    .eq("id", userId);
  if (promote.error) {
    throw new Error(`[spike-02] promote-to-super_admin failed: ${promote.error.message}`);
  }

  return userId;
}

/**
 * Mint a real session for the test user and capture the exact cookies the
 * @supabase/ssr server client writes. Returns a Playwright storageState whose
 * cookies are retargeted at the app origin.
 */
export async function mintStorageState(env: SpikeEnv): Promise<StorageState> {
  const admin = adminClient(env);

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_SUPER_EMAIL,
  });
  if (link.error) {
    throw new Error(`[spike-02] generateLink failed: ${link.error.message}`);
  }
  const hashedToken = link.data.properties?.hashed_token;
  if (!hashedToken) {
    throw new Error("[spike-02] generateLink returned no hashed_token");
  }

  // In-memory cookie jar. The ssr client writes session cookies here via setAll
  // when verifyOtp succeeds — same path as the live app's route handler.
  const jar = new Map<string, string>();
  const ssr = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });

  const verified = await ssr.auth.verifyOtp({ type: "magiclink", token_hash: hashedToken });
  if (verified.error) {
    throw new Error(`[spike-02] verifyOtp failed: ${verified.error.message}`);
  }
  if (jar.size === 0) {
    throw new Error("[spike-02] verifyOtp wrote no cookies — session not captured");
  }

  // 400 days, matching @supabase/ssr DEFAULT_COOKIE_OPTIONS.maxAge.
  const expires = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60;
  const cookies: PlaywrightCookie[] = Array.from(jar, ([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
    httpOnly: false, // DEFAULT_COOKIE_OPTIONS.httpOnly is false in 0.10.2
    secure: false, // localhost is http in dev
    sameSite: "Lax",
    expires,
  }));

  return { cookies, origins: [] };
}

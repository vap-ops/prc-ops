// Client-safe environment validation.
//
// Only NEXT_PUBLIC_* variables live here. This module is safe to import from
// Client Components and is bundled into the browser. Server-only secrets are
// validated in `src/lib/env.server.ts` behind an `import "server-only"` guard.

import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  // Usage-telemetry kill switch (spec 244). Defaults on; set to "false" to stop
  // client capture app-wide without a deploy of the feature itself.
  NEXT_PUBLIC_TELEMETRY_ENABLED: z.string().optional().default("true"),
  // Spec 294: set to "sandbox" ONLY on the sandbox Vercel project — turns on
  // the persistent SandboxBanner. "production" is accepted (and means nothing)
  // so setting it on prod for symmetry can never crash the boot-time parse.
  NEXT_PUBLIC_APP_ENV: z.enum(["sandbox", "production"]).optional(),
  // Vercel system var (auto-exposed when system env vars are enabled); the
  // sandbox banner shows its first 7 chars as the deployed-commit marker.
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  // Build version (feedback 10a15ebe) — next.config.ts synthesizes this from
  // package.json (+ commit SHA) and inlines it so client telemetry can stamp
  // each event with the exact bundle. Optional: unset in dev/test.
  NEXT_PUBLIC_APP_VERSION: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientSchema>;

export function parseClientEnv(raw: Record<string, string | undefined>): ClientEnv {
  const result = clientSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid client environment variables:\n${issues}`);
  }
  return result.data;
}

// Reference each NEXT_PUBLIC_* var by literal name so Next.js can statically
// detect them and inline the values into the client bundle at build time.
// Passing `process.env` whole defeats this detection — the browser sees
// `undefined` and Zod throws at first render.
export const clientEnv = parseClientEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_TELEMETRY_ENABLED: process.env.NEXT_PUBLIC_TELEMETRY_ENABLED,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
});

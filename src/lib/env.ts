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

export const clientEnv = parseClientEnv(process.env);

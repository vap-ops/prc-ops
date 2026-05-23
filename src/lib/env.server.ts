// Server-only environment validation.
//
// The `import "server-only"` directive causes a build error if any client
// component (or any module that ends up in the client bundle) imports this
// file. Use this for secrets that must never reach the browser.
//
// Server code that also needs NEXT_PUBLIC_* values should import `clientEnv`
// from `./env`. Do not duplicate client vars into this module.

import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // LINE Login (server-side only). The app runs LINE's OAuth and HS256
  // id_token verification itself per ADR 0012. Channel secret is the HMAC
  // key for verification; channel id is the audience claim.
  LINE_CHANNEL_ID: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment variables:\n${issues}`);
  }
  return result.data;
}

export const serverEnv = parseServerEnv(process.env);

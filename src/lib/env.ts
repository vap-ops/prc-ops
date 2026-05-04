import { z } from "zod";

// Server-only variables (no NEXT_PUBLIC_ prefix — never sent to the browser)
const serverSchema = z.object({
  // Becomes required when Supabase integration ships
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Becomes required when LINE Login ships
  LINE_CHANNEL_ID: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),
});

// Client-safe variables (NEXT_PUBLIC_ prefix — inlined into the JS bundle at build time)
const clientSchema = z.object({
  // Becomes required when Supabase integration ships
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export const envSchema = serverSchema.merge(clientSchema);

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);

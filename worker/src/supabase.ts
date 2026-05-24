// Service-role Supabase client for the PDF worker. Mirrors the approach in
// scripts/import-wp.ts (separate-process script that builds its own client
// from @supabase/supabase-js + process.env) rather than reusing the app's
// src/lib/db/admin.ts — that module is server-only + Next-coupled and
// throws at module load outside the Next bundler.
//
// The worker is the ONLY mutation path for the reports table by design:
// reports has no app UPDATE policy (see
// supabase/migrations/20260525000000_create_reports.sql). The service role
// bypasses RLS, which is what makes the worker's UPDATE → 'processing' /
// 'complete' / 'failed' work.
//
// Env contract:
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL as a fallback for shared
//     .env.local during local runs) — the project URL.
//   SUPABASE_SERVICE_ROLE_KEY — the secret that authenticates as
//     service_role.
// Reads from process.env regardless of how the env got loaded (tsx
// --env-file=../.env.local for local dev; Railway injects them directly).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

export function createServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url) {
    throw new Error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL). Set it in the worker's environment.",
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in the worker's environment.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

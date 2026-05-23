// Work-packages CSV importer. See ADR 0014 for the full contract.
//
// Usage: pnpm import:wp <PROJECT_CODE> <path-to-file.csv>
//
// This is a plain tsx script — not a Next.js route — so it cannot import
// src/lib/db/admin.ts (which is `server-only` and throws at module load
// outside the Next bundler). The same applies to src/lib/env.server.ts.
// The script builds a minimal service-role client locally from
// @supabase/supabase-js + process.env, and the pnpm-script entry loads
// .env.local via Node's --env-file flag (passed through by tsx).

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { parseAndValidate } from "@/lib/wp-import/parse";

function usage(): never {
  console.error("Usage: pnpm import:wp <PROJECT_CODE> <path-to-file.csv>");
  console.error("Example: pnpm import:wp PRC-2026-001 ./data/lamsonthi-wps.csv");
  process.exit(1);
}

async function main(): Promise<void> {
  const projectCode = process.argv[2];
  const filePath = process.argv[3];
  if (!projectCode || !filePath) usage();

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.",
    );
    console.error(
      "Run via `pnpm import:wp` (loads .env.local through --env-file) or export them manually.",
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Look up the project. Admin client bypasses RLS, so this returns the
  //    row regardless of who runs the CLI.
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("code", projectCode)
    .maybeSingle();
  if (projectErr) {
    console.error(`Failed to query projects: ${projectErr.message}`);
    process.exit(1);
  }
  if (!project) {
    console.error(`No project with code "${projectCode}".`);
    process.exit(1);
  }

  // 2. Existing WP codes for this project. Feeds the conflict check in the
  //    pure validator.
  const { data: existing, error: existingErr } = await supabase
    .from("work_packages")
    .select("code")
    .eq("project_id", project.id);
  if (existingErr) {
    console.error(`Failed to query existing work_packages: ${existingErr.message}`);
    process.exit(1);
  }
  const existingCodes = new Set((existing ?? []).map((r) => r.code));

  // 3. Parse + validate (pure; see src/lib/wp-import/parse.ts).
  const csvText = readFileSync(filePath, "utf8");
  const { rows, errors } = parseAndValidate(csvText, existingCodes);

  if (errors.length > 0) {
    console.error(`Import failed — ${errors.length} validation error(s) in ${filePath}:`);
    for (const e of errors) console.error(`  ${e}`);
    console.error("No rows inserted. Fix the file and re-run.");
    process.exit(1);
  }

  if (rows.length === 0) {
    console.error(`No data rows in ${filePath}.`);
    process.exit(1);
  }

  // 4. Batch insert. Single .insert() call so it's one transaction at the
  //    PostgREST layer; if any constraint fires, the whole batch fails.
  //    status is intentionally omitted — the column default 'not_started'
  //    applies to every imported row (ADR 0014: status is not imported).
  const { error: insertErr } = await supabase.from("work_packages").insert(
    rows.map((r) => ({
      project_id: project.id,
      code: r.code,
      name: r.name,
      description: r.description,
    })),
  );
  if (insertErr) {
    console.error(`Insert failed: ${insertErr.message}`);
    process.exit(1);
  }

  console.log(`Imported ${rows.length} work_package(s) into ${project.code} (${project.name}).`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});

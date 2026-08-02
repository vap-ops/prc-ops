// WP catalogue seeder (spec 389 U2). Loads data/wp-catalog-vol5.tsv into
// wp_catalog_items — upsert by code, so re-running after a sheet fix is safe.
//
// Usage: pnpm import:wp-catalog [path-to.tsv]   (default: data/wp-catalog-vol5.tsv)
//
// Like scripts/import-wp.ts this is a plain tsx script — it cannot import the
// `server-only` admin client, so it builds a service-role client locally and
// the pnpm entry loads .env.local via --env-file.
//
// Refusals (whole file, never partial): duplicate code · blank code/name ·
// unknown prefix (no work_categories.code_prefix match, 'X' → W10 placeholder
// per spec D6) · sub_of that is not a group row in the same file.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

interface Row {
  code: string;
  sub_of: string;
  prefix: string;
  name: string;
  source_note: string;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parseTsv(text: string): Row[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim());
  const need = ["code", "sub_of", "prefix", "name", "old_id", "source_note"];
  if (need.some((c, i) => header[i] !== c)) {
    fail(`Header must be exactly: ${need.join("\\t")} — got: ${header.join("\\t")}`);
  }
  return lines.slice(1).map((l) => {
    const c = l.split("\t");
    return {
      code: (c[0] ?? "").trim(),
      sub_of: (c[1] ?? "").trim(),
      prefix: (c[2] ?? "").trim(),
      name: (c[3] ?? "").trim(),
      source_note: (c[5] ?? "").trim(),
    };
  });
}

async function main(): Promise<void> {
  const filePath = process.argv[2] ?? "data/wp-catalog-vol5.tsv";
  if (!existsSync(filePath)) fail(`File not found: ${filePath}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fail(
      "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY. Run via `pnpm import:wp-catalog`.",
    );
  }

  const rows = parseTsv(readFileSync(filePath, "utf8"));
  if (rows.length === 0) fail("Empty file.");

  // --- validation, whole-file ---
  const errors: string[] = [];
  const seen = new Set<string>();
  const groupCodes = new Set(rows.filter((r) => !r.sub_of).map((r) => r.code));
  rows.forEach((r, i) => {
    const n = i + 2; // 1-based + header
    if (!r.code) errors.push(`Row ${n}: blank code`);
    if (!r.name) errors.push(`Row ${n}: blank name`);
    if (seen.has(r.code)) errors.push(`Row ${n}: duplicate code ${r.code}`);
    seen.add(r.code);
    if (r.sub_of && !groupCodes.has(r.sub_of)) {
      errors.push(`Row ${n}: sub_of ${r.sub_of} is not a group row in the file`);
    }
  });
  if (errors.length > 0) {
    fail(`Refusing the whole file:\n  ${errors.join("\n  ")}`);
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // prefix → work_categories (top-level rows carry code_prefix; 'X' rides W10)
  const { data: cats, error: catErr } = await supabase
    .from("work_categories")
    .select("id, code, code_prefix")
    .not("code_prefix", "is", null);
  if (catErr) fail(`work_categories query failed: ${catErr.message}`);
  const catByPrefix = new Map<string, string>();
  for (const c of cats ?? []) {
    if (c.code_prefix) catByPrefix.set(c.code_prefix, c.id);
  }
  const w10 = (cats ?? []).find((c) => c.code === "W10")?.id;
  if (w10) catByPrefix.set("X", w10);

  const badPrefix = rows.filter((r) => !catByPrefix.has(r.prefix));
  if (badPrefix.length > 0) {
    fail(
      `Refusing the whole file — unknown prefix on: ${badPrefix
        .map((r) => `${r.code} (${r.prefix})`)
        .join(", ")}`,
    );
  }

  // --- upsert groups first (parents), then leaves ---
  const groups = rows.filter((r) => !r.sub_of);
  const leaves = rows.filter((r) => r.sub_of);

  const groupPayload = groups.map((r) => ({
    code: r.code,
    name: r.name,
    code_prefix: r.prefix,
    work_category_id: catByPrefix.get(r.prefix) ?? null,
    is_group: true,
    source_note: r.source_note || null,
  }));
  const { error: gErr } = await supabase
    .from("wp_catalog_items")
    .upsert(groupPayload, { onConflict: "code" });
  if (gErr) fail(`Group upsert failed: ${gErr.message}`);

  const { data: groupRows, error: gqErr } = await supabase
    .from("wp_catalog_items")
    .select("id, code")
    .in("code", [...groupCodes]);
  if (gqErr) fail(`Group re-read failed: ${gqErr.message}`);
  const idByCode = new Map((groupRows ?? []).map((g) => [g.code, g.id]));

  const leafPayload = leaves.map((r) => ({
    code: r.code,
    name: r.name,
    code_prefix: r.prefix,
    work_category_id: catByPrefix.get(r.prefix) ?? null,
    parent_id: idByCode.get(r.sub_of) ?? null,
    is_group: false,
    source_note: r.source_note || null,
  }));
  const { error: lErr } = await supabase
    .from("wp_catalog_items")
    .upsert(leafPayload, { onConflict: "code" });
  if (lErr) fail(`Leaf upsert failed: ${lErr.message}`);

  // --- verify from the DB, not the sheet ---
  const { data: verify, error: vErr } = await supabase
    .from("wp_catalog_items")
    .select("id, code, is_group, parent_id");
  if (vErr) fail(`Verify query failed: ${vErr.message}`);
  const g = (verify ?? []).filter((r) => r.is_group).length;
  const l = (verify ?? []).filter((r) => !r.is_group).length;
  const orphans = (verify ?? []).filter((r) => !r.is_group && !r.parent_id);
  console.log(`wp_catalog_items now: ${g} groups + ${l} leaves = ${(verify ?? []).length}`);
  if (orphans.length > 0) {
    fail(`Orphan leaves (no parent): ${orphans.map((o) => o.code).join(", ")}`);
  }
  console.log("OK");
}

void main();

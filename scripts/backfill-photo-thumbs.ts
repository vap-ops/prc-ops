// Spec 398 U1 — one-off backfill of stored thumbnails for every existing photo.
//
// Why a script and not lazy-on-read: lazy generation makes the first view of every
// photo slower forever and leaves the acceptance metric unmeasurable (spec 398 D6).
//
// Idempotent and resumable: existing thumbs are detected in BULK with createSignedUrls
// (which costs no bytes and no image transformations) and skipped, and the generator
// uploads with `upsert: false` so a race is a 409 that reads as "exists".
//
// Usage: pnpm backfill:photo-thumbs [--limit N] [--dry-run]
//
// Like scripts/import-wp.ts, this is a plain tsx script — it cannot import
// src/lib/db/admin.ts (server-only) and builds its own service-role client.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { defaultThumbDeps, generatePhotoThumb } from "@/lib/photos/generate-thumb";
import { thumbKeyFor } from "@/lib/photos/thumb-key";
import { PHOTOS_BUCKET } from "@/lib/storage/buckets";

const PAGE = 1000;
/** Kept low on purpose: each job downloads a full-size original (~600 KB) and this
 *  runs against production Storage. Wall-clock is not the constraint here. */
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");

const admin = createClient<Database>(url, key, { auth: { persistSession: false } });
const deps = defaultThumbDeps(admin);

async function allPhotoPaths(): Promise<string[]> {
  const paths: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("photo_logs")
      .select("storage_path")
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`photo_logs read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) if (row.storage_path) paths.push(row.storage_path);
    if (data.length < PAGE) break;
  }
  // A superseded photo and its replacement are separate rows with separate objects,
  // but defensively de-dupe: one object never needs two thumbnails.
  return [...new Set(paths)];
}

/** Which of these originals have NO thumbnail yet. Bulk, byte-free, quota-free. */
async function missingThumbs(paths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (let i = 0; i < paths.length; i += 100) {
    const slice = paths.slice(i, i + 100);
    const keys = slice.map((p) => thumbKeyFor(p));
    const { data, error } = await admin.storage.from(PHOTOS_BUCKET).createSignedUrls(keys, 60);
    if (error) throw new Error(`createSignedUrls failed: ${error.message}`);
    const byPath = new Map((data ?? []).map((d) => [d.path, d]));
    for (let j = 0; j < slice.length; j++) {
      const entry = byPath.get(keys[j]!);
      if (!entry || entry.error || !entry.signedUrl) missing.push(slice[j]!);
    }
  }
  return missing;
}

async function main() {
  const paths = await allPhotoPaths();
  console.log(`photo_logs objects: ${paths.length}`);

  const todo = (await missingThumbs(paths)).slice(0, limit);
  console.log(`missing thumbnails: ${todo.length}${dryRun ? " (dry run — stopping here)" : ""}`);
  if (dryRun || todo.length === 0) return;

  const counts = { created: 0, exists: 0, failed: 0 };
  const failures: string[] = [];
  let next = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= todo.length) return;
        const outcome = await generatePhotoThumb(todo[i]!, deps);
        counts[outcome.status] += 1;
        if (outcome.status === "failed") failures.push(`${todo[i]} — ${outcome.reason}`);
        const done = counts.created + counts.exists + counts.failed;
        if (done % 100 === 0) console.log(`  ${done}/${todo.length} …`);
      }
    }),
  );

  console.log(`created ${counts.created} · exists ${counts.exists} · failed ${counts.failed}`);
  // Print every failure: a silent cap would read as "covered everything" when it did not.
  for (const f of failures) console.log(`  FAILED ${f}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Spec 123 / ADR 0047: single source for the generated Supabase types.
//
// Runs `supabase gen types typescript --linked` once and writes BOTH the app
// copy and the worker's vendored copy. The worker is not a pnpm-workspace
// member (own lockfile, Railway root=/worker) so it cannot import from
// ../src (see worker/src/supabase.ts) — it keeps a byte-identical copy
// instead. The drift guard tests/unit/db-types-sync.test.ts fails if the two
// ever diverge.
//
// Requires a linked Supabase CLI session (`supabase login` + `pnpm db:link`).
// Run via `pnpm db:types`.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const APP = "src/lib/db/database.types.ts";
const WORKER = "worker/src/database.types.ts";

// shell:true so the platform resolves the supabase binary (supabase.exe /
// .cmd on Windows, the node_modules/.bin shim under pnpm).
const result = spawnSync("supabase", ["gen", "types", "typescript", "--linked"], {
  encoding: "utf8",
  shell: true,
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "");
  throw new Error(`supabase gen types failed (exit ${String(result.status)})`);
}

const types = result.stdout;
if (!types.includes("export type Database")) {
  throw new Error("supabase gen types produced unexpected output (no `export type Database`)");
}

writeFileSync(APP, types);
writeFileSync(WORKER, types);
process.stdout.write(`wrote ${APP} and ${WORKER} (${String(types.length)} bytes each)\n`);

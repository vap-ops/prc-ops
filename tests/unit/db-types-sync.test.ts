import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Spec 123 / ADR 0047: the worker keeps a vendored copy of the generated
// Supabase types because it is not a pnpm-workspace member (own lockfile,
// Railway root=/worker) and so cannot import from ../src. Regeneration
// (scripts/gen-db-types.ts) writes BOTH files; this guard fails red if a
// schema change ever updates only one of them.

const APP = join(process.cwd(), "src/lib/db/database.types.ts");
const WORKER = join(process.cwd(), "worker/src/database.types.ts");

// EOL-normalize (Windows cloud PC) + drop trailing whitespace so the guard
// tracks real content drift, not line-ending noise.
const norm = (s: string): string =>
  s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+$/, "");

describe("generated DB types stay in sync across app and worker", () => {
  it("worker copy is identical to the app copy", () => {
    const app = norm(readFileSync(APP, "utf8"));
    const worker = norm(readFileSync(WORKER, "utf8"));
    expect(worker).toBe(app);
  });
});

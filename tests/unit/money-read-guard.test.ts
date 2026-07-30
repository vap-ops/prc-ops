import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MONEY_TABLES, REGISTERED_MONEY_READ_SITES } from "@/lib/accounting/money-read-policy";

// ERD audit M5 — the integration guard. Money tables are RLS zero-grant and read
// only via the admin client (no DB tenant backstop). This test fails if any money
// table is read from a file not registered in money-read-policy.ts, so a new money
// read can never be added without consciously classifying it firm-wide or
// project-scoped (see that module).

const SRC = "src";

/** Filesystem work the sweep actually performed — read by the cheapness guard.
 *  `read` holds the DISTINCT files opened, so `files > read.size` means some
 *  file was opened twice, i.e. the tree was swept more than once. */
const io = { dirs: 0, files: 0, read: new Set<string>() };

function walk(dir: string): string[] {
  io.dirs += 1;
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

let discovered: readonly string[] | null = null;

/** Files that contain a direct `.from("<money table>")` read.
 *
 *  Memoized: the two tests below ask the same question of the same tree, and
 *  each call walks + reads all ~1036 `.ts`/`.tsx` files under src/ (5.8 MB).
 *  Running it twice cost ~380ms idle but up to 6080ms under full-suite CPU+IO
 *  load on the Windows box — past vitest's 5000ms default, seen RED 2026-07-30.
 *  Linux CI is far too fast to ever catch a revert, so the sweep is pinned to
 *  exactly one pass by the cheapness guard at the bottom of this file. */
function discoverMoneyReadSites(): readonly string[] {
  if (discovered) return discovered;
  const ignore = new Set([
    "src/lib/db/database.types.ts",
    "src/lib/accounting/money-read-policy.ts",
  ]);
  const patterns = MONEY_TABLES.flatMap((t) => [`.from("${t}")`, `.from('${t}')`]);
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const rel = toPosix(relative(".", file));
    if (ignore.has(rel)) continue;
    io.files += 1;
    io.read.add(rel);
    const text = readFileSync(file, "utf8");
    if (patterns.some((p) => text.includes(p))) hits.push(rel);
  }
  discovered = hits.sort();
  return discovered;
}

// Warmed in a hook so the one-time cost lands on hookTimeout rather than on
// whichever `it` happens to run first.
beforeAll(() => {
  discoverMoneyReadSites();
});

describe("money-read tenant-scope guard (ERD audit M5)", () => {
  it("every money-table read site is registered in money-read-policy.ts", () => {
    const sites = discoverMoneyReadSites();
    const registered = new Set(REGISTERED_MONEY_READ_SITES);
    const unregistered = sites.filter((f) => !registered.has(f));
    expect(
      unregistered,
      `These files read a money table but are not registered in money-read-policy.ts.\n` +
        `Classify each as firm-wide or project-scoped (and ensure project-scoped reads carry a project/WP filter):\n` +
        unregistered.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("no registered money-read site is stale (each still reads a money table)", () => {
    const sites = new Set(discoverMoneyReadSites());
    const stale = REGISTERED_MONEY_READ_SITES.filter((f) => !sites.has(f));
    expect(
      stale,
      `These files are registered in money-read-policy.ts but no longer read a money table — remove them:\n` +
        stale.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  // The cheapness guard. Both tests above scan the whole src tree, so this file
  // is only affordable while that scan runs ONCE — and the regression breaks no
  // assertion and cannot go red on Linux CI, so it is pinned here instead.
  it("discovers the read sites with exactly one sweep of src/", () => {
    const sites = discoverMoneyReadSites();
    // A collapsed walk would leave test 1 passing vacuously (nothing found ⇒
    // nothing unregistered). Test 2 would catch it, but state it outright.
    expect(
      io.files,
      "the src/ sweep came back near-empty — test 1 above is now vacuous",
    ).toBeGreaterThan(500);
    expect(
      sites.length,
      "no money-read site was discovered at all — test 1 above is now vacuous",
    ).toBeGreaterThan(0);

    // ONE sweep, not just one per caller: opening any file twice means the tree
    // was walked again inside the loader, which a memo check cannot see.
    expect(io.files, "some file under src/ was opened more than once").toBe(io.read.size);

    const before = { dirs: io.dirs, files: io.files };
    discoverMoneyReadSites();
    expect(
      { dirs: io.dirs, files: io.files },
      "discoverMoneyReadSites() must be memoized — a later call re-walked or re-read src/",
    ).toEqual(before);
  });

  it("reads the filesystem only from the memoized sweep", () => {
    // The counters cannot see a test that calls fs directly, so pin the call
    // sites too — this file is the one that actually timed out, so the revert it
    // guards against is a live risk. The needle is built from a variable so the
    // assertion cannot match itself, and whitespace is collapsed so a reflowed
    // call still counts. Expected: the sweep's read, and this file's own below.
    const countCalls = (src: string, fn: string) =>
      src.replace(/\s+/g, "").split(`${fn}(`).length - 1;
    const own = readFileSync(__filename, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(
      countCalls(own, "readFileSync"),
      "a file read appeared outside discoverMoneyReadSites() — if it is a whole-tree sweep, reuse the memoized one; if it is a genuinely unrelated one-off read, bump this pin",
    ).toBe(2);
    expect(
      countCalls(own, "readdirSync"),
      "src/ must be walked from walk() alone — if this is an unrelated one-off, bump this pin",
    ).toBe(1);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MONEY_TABLES, REGISTERED_MONEY_READ_SITES } from "@/lib/accounting/money-read-policy";

// ERD audit M5 — the integration guard. Money tables are RLS zero-grant and read
// only via the admin client (no DB tenant backstop). This test fails if any money
// table is read from a file not registered in money-read-policy.ts, so a new money
// read can never be added without consciously classifying it firm-wide or
// project-scoped (see that module).

const SRC = "src";

function walk(dir: string): string[] {
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

/** Files that contain a direct `.from("<money table>")` read. */
function discoverMoneyReadSites(): string[] {
  const ignore = new Set([
    "src/lib/db/database.types.ts",
    "src/lib/accounting/money-read-policy.ts",
  ]);
  const patterns = MONEY_TABLES.flatMap((t) => [`.from("${t}")`, `.from('${t}')`]);
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const rel = toPosix(relative(".", file));
    if (ignore.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    if (patterns.some((p) => text.includes(p))) hits.push(rel);
  }
  return hits.sort();
}

describe("money-read tenant-scope guard (ERD audit M5)", () => {
  it("every money-table read site is registered in money-read-policy.ts", () => {
    const discovered = discoverMoneyReadSites();
    const registered = new Set(REGISTERED_MONEY_READ_SITES);
    const unregistered = discovered.filter((f) => !registered.has(f));
    expect(
      unregistered,
      `These files read a money table but are not registered in money-read-policy.ts.\n` +
        `Classify each as firm-wide or project-scoped (and ensure project-scoped reads carry a project/WP filter):\n` +
        unregistered.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("no registered money-read site is stale (each still reads a money table)", () => {
    const discovered = new Set(discoverMoneyReadSites());
    const stale = REGISTERED_MONEY_READ_SITES.filter((f) => !discovered.has(f));
    expect(
      stale,
      `These files are registered in money-read-policy.ts but no longer read a money table — remove them:\n` +
        stale.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});

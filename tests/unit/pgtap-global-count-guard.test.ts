// Writing failing test first.
//
// The #954 class: a pgTAP assertion that counts a WHOLE table the app writes to.
// It passes for as long as the table is empty in production, then reds the moment a
// real user creates the first row — and it reds **on the merge ref only**, because a
// PR-ref pgTAP run short-circuits to success by design (ADR 0083 §4). So the failure
// never appears as a red check on anyone's PR: it appears as green PRs silently
// EJECTING from the merge queue, repo-wide, until someone reads the merge_group runs.
// That cost ~90 minutes across every lane on 2026-08-04 (`report_selected_photos`,
// counted as a project_director whose can_see_project blanket arm sees every project).
//
// The sweep (#955) fixed the four live instances and emptied known-red.json. This
// guard stops the next one being written. It is a VITEST test, deliberately: it must
// fail on the PR ref, where the author can still see it — a pgTAP test could not.
//
// What counts as dangerous:
//   count(*) from <TABLE>   with no WHERE narrowing it, asserted against a NON-ZERO
//   expectation.
// What does not:
//   - a FUNCTION result — `count(*) from get_x(...)`, `unnest(...)`: scoped by its
//     arguments. Detected structurally (a call has parentheses), so no name list ages.
//   - a CTE — `with u_ok as (...) select count(*) from u_ok`: local to the query.
//   - an expectation of 0 — RLS denies production rows too, so it stays 0.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/tests/database";

/** `count(*) [::int] from [public.]<name>` + whatever follows, up to the statement end. */
const COUNT_RE =
  /count\(\s*\*\s*\)(?:::int)?\s+from\s+(?:public\.)?([a-z_0-9]+)(\s*\(?)((?:[^;()]|\([^()]*\))*)/gi;

export interface CountSite {
  file: string;
  line: number;
  table: string;
  expected: number;
}

/** Every unscoped, non-zero-expectation count over a real table. */
export function findGlobalCountSites(dir: string): CountSite[] {
  const out: CountSite[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const raw = readFileSync(join(dir, file), "utf8");
    // Strip line comments FIRST: a comment explaining the rule must not trip it (the
    // house has been bitten by guards satisfied — or broken — by their own docs).
    const src = raw.replace(/^\s*--.*$/gm, "");
    // CTE names are local scratch, never production tables.
    const ctes = new Set(
      [...src.matchAll(/(?:with|,)\s+([a-z_0-9]+)\s+as\s*\(/gi)].map((m) => m[1]!.toLowerCase()),
    );
    for (const m of src.matchAll(COUNT_RE)) {
      const table = m[1]!.toLowerCase();
      const isCall = m[2]!.includes("("); // a function call, scoped by its args
      const tail = m[3] ?? "";
      if (isCall || ctes.has(table)) continue;
      if (/\bwhere\b/i.test(tail)) continue; // scoped
      // The expected value follows the closing paren of the count subquery: `), N,`
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 160);
      const exp = after.match(/\)\s*,\s*(\d+)/);
      if (!exp) continue; // not an is(count, N) shape — e.g. ok(count >= N)
      const expected = Number(exp[1]);
      if (expected === 0) continue; // an RLS-denied arm stays 0 whatever prod holds
      out.push({ file, line: src.slice(0, m.index).split("\n").length, table, expected });
    }
  }
  return out;
}

// The LEDGER: every site below counts a whole table but is SAFE because the assertion
// runs under a role whose RLS narrows the table to the test's own seeded rows. Each
// was verified against the live row count during the #955 sweep — the table has far
// more production rows than the expectation, and the file is green, which is only
// possible if RLS is doing the narrowing.
const ALLOWED: ReadonlyArray<string> = [
  "116-worker-portal-binding.test.sql:workers",
  "116-worker-portal-binding.test.sql:labor_logs",
  "118-polymorphic-consents.test.sql:contractor_consents",
  "201-worker-bank-change.test.sql:worker_bank_change_requests",
  "249-interaction-events.test.sql:interaction_events",
  "250-usage-daily.test.sql:usage_daily",
  "306-muster.test.sql:muster_teams",
  "314-level-rates.test.sql:labor_wht_config",
  "38-contractor-portal-rls.test.sql:contractors",
  "38-contractor-portal-rls.test.sql:workers",
  "38-contractor-portal-rls.test.sql:labor_logs",
  "39-contractor-bank-change.test.sql:contractor_bank_change_requests",
  "51-contractor-onboarding.test.sql:contractor_consents",
  "98-sell-rate-foundation.test.sql:sell_rate_table",
];

describe("pgTAP global-count guard (the #954 class)", () => {
  it("matches the ledger EXACTLY — no new site, and no stale entry", () => {
    const sites = findGlobalCountSites(DIR);
    const found = [...new Set(sites.map((s) => `${s.file}:${s.table}`))].sort();
    // EXACT, not a subset check: a one-directional guard lets a FIXED site keep its
    // ledger row, and the ledger then lies about what is still unscoped.
    expect(
      found,
      `New unscoped count(*) over a whole table. This is the #954 class: it passes ` +
        `until the first production row exists, then reds on the MERGE ref only — no PR ` +
        `check can show it, so every lane's green PR starts ejecting from the merge ` +
        `queue. FIX: scope the count to the rows the test seeded (a WHERE on the seeded ` +
        `ids/keys), or assert ok(count >= N) if the set is operator-writable and may ` +
        `grow. Only add to ALLOWED if RLS provably narrows the table to the seeded rows ` +
        `for the acting role — and say so in review. If an entry DISAPPEARED you fixed ` +
        `one: delete its row here in the same PR.`,
    ).toEqual([...ALLOWED].sort());
  });

  // Not vacuous: the scanner must actually see the corpus it is guarding.
  it("scans the real pgTAP corpus", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(300);
    expect(findGlobalCountSites(DIR).length).toBeGreaterThan(0);
  });

  // The exclusions are load-bearing logic and get their own coverage (a new static
  // guard's first run is a list of SUSPECTS, and its exclusions are where the blind
  // spots hide).
  it("ignores function results, CTEs, scoped counts and zero-expectations", () => {
    const dir = join(process.cwd(), "supabase/tests/database");
    const sites = findGlobalCountSites(dir);
    const keys = sites.map((s) => `${s.file}:${s.table}`);
    // functions: arg-scoped, present in the corpus in numbers
    expect(keys.some((k) => k.includes(":get_"))).toBe(false);
    expect(keys.some((k) => k.endsWith(":unnest"))).toBe(false);
    expect(keys.some((k) => k.endsWith(":wp_status_history"))).toBe(false);
    // CTE aliases used by 261/288
    expect(keys.some((k) => k.endsWith(":u_ok") || k.endsWith(":u_pm"))).toBe(false);
    // the swept files now use ok(count >= N) or a WHERE, so they must be gone
    expect(keys.some((k) => k.endsWith(":work_categories"))).toBe(false);
    expect(keys.some((k) => k.endsWith(":catalog_categories"))).toBe(false);
    expect(keys.some((k) => k.endsWith(":departments"))).toBe(false);
    expect(keys.some((k) => k.endsWith(":report_selected_photos"))).toBe(false);
  });
});

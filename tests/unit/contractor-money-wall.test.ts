// Writing failing test first.
//
// Spec 328 §2.4 — the contractor-member money wall, pinned as an INVENTORY.
// workers.contractor_id IS NOT NULL ⇒ pay-exempt subcon member (the firm pays
// them; PRC never does). Every surface that feeds workers into a pay path must
// exclude contractor-tied rows. Behavior pins live next to each surface
// (labor-group-workers / fetch-zone-data / payout-nominee-bankless tests); this
// file source-pins the query-level filters that have no unit seam of their own,
// so a refactor that drops one fails CI loudly instead of silently reopening
// the wall.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

describe("spec 328 §2.4 — contractor money wall (query pins)", () => {
  it("sa/plan crew picker excludes contractor-tied workers (crew → mark-present → labor_logs)", () => {
    const page = src("src/app/sa/plan/page.tsx");
    const workersRead = page.slice(page.indexOf('from("workers")'));
    expect(workersRead).toContain('.is("contractor_id", null)');
  });

  it("payout-nominee bankless picker excludes contractor-tied workers", () => {
    expect(src("src/lib/payroll/payout-nominee.ts")).toContain('.is("contractor_id", null)');
  });

  it("WP capture picker (groupRoster) excludes contractor-tied workers", () => {
    expect(src("src/lib/labor/group-workers.ts")).toContain("w.contractor_id === null");
  });

  // Spec 330 U3a — the wall finally has a DB arm. Spec 330 U2 opened the first
  // write path into crew_members, and the /sa/plan DRAFT reads crews +
  // crew_members UNFILTERED (only the manual picker above is filtered), so a
  // crew row walks straight into set_daily_plan_item_crew → mark-present →
  // log_labor_day → payroll. Guarding every reader is unbounded; the write is
  // one place. Pinned here so the arm can't be dropped by a later re-source of
  // these RPC bodies (a CREATE OR REPLACE from an older migration file would
  // silently reopen the wall — the exact class of the 075817→075818 sequence).
  // Pinning the U3a migration alone would be vacuous — migrations are
  // append-only, so the regression this guards against (a LATER migration
  // re-sourcing an older body and dropping the arm) lands in a NEW file and
  // leaves that pin green. So: scan the whole migrations dir, take the LAST
  // definition of each walled function, and require the arm to survive there.
  const MIGRATIONS = "supabase/migrations";
  const WALLED_FNS = [
    "add_worker_to_crew",
    "move_worker_between_crews",
    "create_crew",
    "set_crew_lead",
    "reassign_crew_lead",
  ];

  function lastDefinitionOf(fn: string): string {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // timestamp-prefixed — lexical order IS apply order
    let latest = "";
    for (const file of files) {
      const text = src(join(MIGRATIONS, file));
      // Case-INsensitive, and dollar-quote-tag agnostic. A migration re-emitted
      // from `pg_get_functiondef` writes `CREATE OR REPLACE FUNCTION public.f(`
      // in upper case and closes with `$function$`, not `$$;`. A scanner that
      // matched only the hand-written lower-case `$$;` form would skip that file
      // and silently resolve to an OLDER definition — pinning a body that is no
      // longer the one in the database, which is the exact regression this whole
      // block exists to catch.
      const lower = text.toLowerCase();
      const start = lower.indexOf(`function public.${fn.toLowerCase()}(`);
      if (start === -1) continue;
      const endDollar = text.indexOf("$$;", start);
      const endTagged = text.indexOf("$function$\n", text.indexOf("$function$", start) + 1);
      const ends = [endDollar, endTagged].filter((i) => i !== -1);
      const end = ends.length ? Math.min(...ends) : -1;
      latest = text.slice(start, end === -1 ? undefined : end);
    }
    return latest;
  }

  it.each(WALLED_FNS)("the LAST definition of %s carries the money wall", (fn) => {
    const body = lastDefinitionOf(fn);
    expect(body, `${fn} has no definition in ${MIGRATIONS}`).not.toBe("");
    expect(body).toMatch(/contractor/);
    expect(body).toMatch(/pay-exempt and cannot (join|lead) a crew/);
  });

  // Spec 306 U5a's derive is the most DIRECT pay-path writer there is — it writes
  // labor_logs itself — so it belongs in this inventory. It is not in WALLED_FNS
  // because those assert the crew-specific phrase ("cannot join/lead a crew"),
  // which does not describe this surface: the derive never touches crews, it
  // simply must not turn a firm-paid worker's attendance into a PRC wage.
  it("the LAST definition of derive_muster_labor carries the money wall", () => {
    const body = lastDefinitionOf("derive_muster_labor");
    expect(body, `derive_muster_labor has no definition in ${MIGRATIONS}`).not.toBe("");
    expect(body).toContain("v_worker.contractor_id is null");
  });

  // The trigger layer is what makes the wall true for writers nobody has
  // written yet (a future RPC, approve_crew_registration, a direct write).
  it("the crew graph carries writer-agnostic money-wall triggers", () => {
    const mig = src(join(MIGRATIONS, "20260813075818_spec330u3a_crew_contractor_wall.sql"));
    for (const trigger of [
      "crew_members_money_wall",
      "crews_lead_money_wall",
      "workers_firm_tie_money_wall",
    ]) {
      expect(mig).toContain(`create trigger ${trigger}`);
    }
  });
});

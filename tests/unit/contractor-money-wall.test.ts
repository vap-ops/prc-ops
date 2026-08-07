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
import { beforeAll, describe, expect, it } from "vitest";

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
  // leaves that pin green. So: find the LAST definition of each walled function
  // across the whole migrations dir, and require the arm to survive there.
  const MIGRATIONS = "supabase/migrations";
  const WALLED_FNS = [
    "add_worker_to_crew",
    "move_worker_between_crews",
    "create_crew",
    "set_crew_lead",
    "reassign_crew_lead",
  ];
  // Spec 306 U5a's derive is the most DIRECT pay-path writer there is — it
  // writes labor_logs itself — so it belongs in this inventory. It is NOT in
  // WALLED_FNS because those assert the crew-specific phrase ("cannot join/lead
  // a crew"), which does not describe this surface: the derive never touches
  // crews, it simply must not turn a firm-paid worker's attendance into a PRC
  // wage. Its own assertion (contractor_id is null) lives below.
  const DERIVE_FN = "derive_muster_labor";
  // Spec 400 U3a split the derive into a GATED public entry point and an
  // unexported mechanism, so procurement's re-close could derive wages without
  // procurement gaining the labour engine's authority. The money wall went WITH
  // THE MECHANISM — which is correct, and which silently moved it out of this
  // guard's reach: the wall is still enforced, but `derive_muster_labor`'s last
  // definition is now a wrapper that contains no `contractor_id` arm at all.
  // This guard caught that on the first full run, which is exactly its job.
  //
  // ⚠️ The pin therefore follows the WRITER, not the name. Whichever function
  // holds the `insert into public.labor_logs` is the one that must carry the wall
  // — see the delegation assertion below, which is what stops a future edit from
  // re-inlining a wall-less body back into the public wrapper and leaving both
  // pins green. (Matching is on `function public.<name>(` including the paren, so
  // DERIVE_FN does not accidentally resolve to this longer name.)
  const DERIVE_INTERNAL_FN = "derive_muster_labor_internal";
  // Spec 306 — the MANUAL twin of the derive, and the other direct labor_logs
  // writer. It carried no contractor guard at all until 075885: spec 328 U3
  // filtered the picker, so the wall existed only in the UI and any caller of
  // the RPC walked straight through it. Same reason as the derive for living
  // outside WALLED_FNS — the crew-specific phrase does not describe it.
  const MANUAL_FN = "log_labor_day";
  const WANTED = [...WALLED_FNS, DERIVE_FN, DERIVE_INTERNAL_FN, MANUAL_FN];

  // Extract the CREATE ... FUNCTION body starting at `start`. A migration
  // re-emitted from `pg_get_functiondef` closes with `$function$`; a
  // hand-written one closes with `$$;`. Take whichever terminator comes first.
  // ⚠️ FIXED 2026-08-08 (post-merge review of #1000). The old terminator list was
  // `$$;` and `$function$\n` — but a function written `end; $function$;` closes with
  // `$function$` followed by a SEMICOLON, matching NEITHER. So the extraction ran past
  // the real end, all the way to the next function's OPENING tag or EOF: in
  // 075913 the "body" of derive_muster_labor_internal spanned ~180 extra lines and
  // swallowed the revoke block plus the next function's header comment.
  //
  // Why that is dangerous rather than merely untidy: a later migration could re-emit
  // derive_muster_labor_internal WITHOUT the subcon money wall, and as long as anything
  // else in the same file contained `v_worker.contractor_id is null`, the overshooting
  // span would still contain the phrase and the guard would pass. The wall would be
  // reopened with this test green — the exact regression the block exists to catch.
  //
  // Terminate on the closing tag followed by optional whitespace and `;`, and on a bare
  // tag-at-end-of-line, taking whichever comes first.
  function extractDefinition(text: string, start: number): string {
    const after = text.indexOf("$function$", start) + 1;
    const candidates = [
      text.indexOf("$$;", start),
      // `$function$;` / `$function$ ;` — the pg_get_functiondef-style close.
      (() => {
        const m = /\$function\$\s*;/.exec(text.slice(after));
        return m ? after + m.index : -1;
      })(),
      // `$function$` alone on the line, for hand-written bodies.
      text.indexOf("$function$\n", after),
    ];
    const ends = candidates.filter((i) => i !== -1);
    const end = ends.length ? Math.min(...ends) : -1;
    return text.slice(start, end === -1 ? undefined : end);
  }

  // ONE reverse sweep resolves the LAST definition of every wanted function.
  //
  // Why reverse-and-stop instead of forward-take-last: migration filenames are
  // timestamp-prefixed, so lexical order IS apply order. The forward sweep this
  // replaced re-read the ENTIRE dir once per function (6 × ~585 files ≈ 3510
  // reads / ~29 MB) — cheap on CI Linux, but on the Windows dev box under suite
  // load each `it` blew past vitest's 5000ms default and the file flaked.
  // Walking from the NEWEST file and stopping each function at its first hit is
  // provably identical (append-only ⇒ the last file to CONTAIN the definition
  // is the newest to contain it) and reads only the newest slice (~54 files).
  // Done ONCE in beforeAll so every assertion below reads from the map.
  //
  // Case-INsensitive on the needle: `pg_get_functiondef` writes
  // `CREATE OR REPLACE FUNCTION public.f(` in upper case, so a matcher tuned to
  // the hand-written lower-case form would skip that file and silently resolve
  // to an OLDER body — pinning a definition no longer in the database, the exact
  // regression this whole block exists to catch.
  const lastDefinition = new Map<string, string>();
  let sqlFileCount = 0;
  let filesRead = 0;

  beforeAll(() => {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // timestamp-prefixed — lexical order IS apply order
    sqlFileCount = files.length;
    for (const file of files.slice().reverse()) {
      if (lastDefinition.size === WANTED.length) break;
      const text = src(join(MIGRATIONS, file));
      filesRead++;
      const lower = text.toLowerCase();
      for (const fn of WANTED) {
        if (lastDefinition.has(fn)) continue;
        const start = lower.indexOf(`function public.${fn.toLowerCase()}(`);
        if (start !== -1) lastDefinition.set(fn, extractDefinition(text, start));
      }
    }
  });

  it.each(WALLED_FNS)("the LAST definition of %s carries the money wall", (fn) => {
    const body = lastDefinition.get(fn) ?? "";
    expect(body, `${fn} has no definition in ${MIGRATIONS}`).not.toBe("");
    expect(body).toMatch(/contractor/);
    expect(body).toMatch(/pay-exempt and cannot (join|lead) a crew/);
  });

  it("the LAST definition of derive_muster_labor_internal carries the money wall", () => {
    const body = lastDefinition.get(DERIVE_INTERNAL_FN) ?? "";
    expect(body, `${DERIVE_INTERNAL_FN} has no definition in ${MIGRATIONS}`).not.toBe("");
    expect(body).toContain("v_worker.contractor_id is null");
  });

  // The extraction must STOP at the function's own terminator. Without this, the
  // `toContain` above is satisfiable by a phrase belonging to a DIFFERENT function that
  // happens to sit later in the same migration file — so the money wall could be
  // dropped from the real body and this suite would stay green (the defect that shipped
  // in #1000 and was found post-merge). These two markers both live AFTER
  // derive_muster_labor_internal ends in 075913, so their absence proves the boundary.
  it("extractDefinition stops at the function terminator and does not overshoot", () => {
    const body = lastDefinition.get(DERIVE_INTERNAL_FN) ?? "";
    expect(body).not.toBe("");
    expect(body, "overshot into the revoke block that follows the function").not.toMatch(
      /revoke\s+all\s+on\s+function/i,
    );
    expect(body, "overshot into the next function's definition").not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.derive_muster_labor\s*\(/i,
    );
  });

  // The wall lives with the writer, so this asserts the writer has not MOVED BACK.
  // Without it, re-inlining the mechanism into the public wrapper (dropping the
  // contractor arm on the way) leaves the assertion above pinned to a stale
  // `_internal` definition that nothing calls — green over the exact regression
  // the whole block exists to catch.
  it("derive_muster_labor delegates and does not itself write labor_logs", () => {
    const body = lastDefinition.get(DERIVE_FN) ?? "";
    expect(body, `derive_muster_labor has no definition in ${MIGRATIONS}`).not.toBe("");
    expect(body).toContain("derive_muster_labor_internal");
    // If this ever fails, the wrapper became a writer again and must carry the
    // wall itself — restore `v_worker.contractor_id is null` to it, or re-delegate.
    expect(body).not.toMatch(/insert\s+into\s+public\.labor_logs/i);
  });

  // Spec 306 — the manual writer reaches the same table, so it needs the same
  // pin. It refuses rather than skips (a person is waiting on an answer, unlike
  // the derive's batch), hence the different predicate.
  it("the LAST definition of log_labor_day carries the money wall", () => {
    const body = lastDefinition.get(MANUAL_FN) ?? "";
    expect(body, `log_labor_day has no definition in ${MIGRATIONS}`).not.toBe("");
    expect(body).toContain("v_worker.contractor_id is not null");
    expect(body).toContain("paid by a subcontractor firm");
  });

  // This suite is Windows-load-only: it is GREEN on CI Linux however slow the
  // sweep is, so a regression that reverts the beforeAll to a per-function
  // full-dir sweep can NEVER go red in CI. Pin the cheapness itself — the
  // reverse sweep must terminate in the newest slice of the dir, never walk all
  // ~585 files. A forward full-sweep pushes filesRead to sqlFileCount and reds
  // this. (Mutation-checked by removing the early-break: 11 ran, only this 1
  // failed — the wall assertions stay green, so the guard is isolated.)
  it("finds every walled definition without re-reading the whole migrations dir", () => {
    expect(lastDefinition.size).toBe(WANTED.length);
    expect(filesRead).toBeGreaterThan(0);
    expect(filesRead).toBeLessThan(sqlFileCount / 2);
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

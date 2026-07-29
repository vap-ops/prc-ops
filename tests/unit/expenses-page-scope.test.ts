// Spec 373 — /expenses page wiring pins. The page is a Server Component vitest
// cannot render, so its scope branch is pinned by source scan: comments
// stripped first, presence pinned at the ACTUAL use count (a bare toContain is
// satisfied by the import line alone), and the structural facts the unit
// exists for (the RPC is called with the source filter + explicit limit; the
// summary/list swap on the resolved scope) each have an assertion that dies
// with them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const src = stripComments(readFileSync("src/app/expenses/page.tsx", "utf8"));
const count = (needle: string) => src.split(needle).length - 1;

describe("spec 373 — /expenses page scope wiring", () => {
  it("resolves the scope through the pure resolver (import + call)", () => {
    expect(count("resolveExpenseScope")).toBeGreaterThanOrEqual(2);
  });

  it("loads the firm-wide list only under the all scope, own list otherwise", () => {
    expect(count("listAllExpenses")).toBeGreaterThanOrEqual(2);
    expect(count("listMyExpenses")).toBeGreaterThanOrEqual(2);
    // The swap is scope-keyed, not role-keyed — the resolver owns the role gate.
    expect(src).toMatch(/scope === "all"/);
  });

  it("review status comes from the shared paged review-map helper on the AUTHED session", () => {
    // The paging loop (p_offset until a short page — the RPC clamps at 200)
    // lives in fetchOfficeExpenseReviewMap, shared with the export route; the
    // page must call it with the AUTHED client, never re-inline the RPC.
    expect(count("fetchOfficeExpenseReviewMap")).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/fetchOfficeExpenseReviewMap\(supabase\)/);
    expect(src).not.toContain("list_money_events_for_review");
  });

  it("the all scope offers the CSV export door carrying the live filters (§5)", () => {
    expect(src).toContain("/expenses/export");
    // The door threads the month + project params, not a bare href.
    expect(src).toMatch(/\/expenses\/export\?[^"`]*m=/);
  });

  it("renders the scope chips and the all-scope month filter", () => {
    expect(count("ExpenseScopeChips")).toBeGreaterThanOrEqual(2);
    expect(count("expenseMonthRange")).toBeGreaterThanOrEqual(2);
  });

  it("submitter names go through the admin seam only under the all scope", () => {
    // The admin client import exists and listAllExpenses receives it.
    expect(count("createAdminClient")).toBeGreaterThanOrEqual(2);
  });

  it("the reimburse queue is enriched from the SAME review map and gets the referrer (D5)", () => {
    // Both consumers consult the map — the list rows AND the queue rows. A
    // mutation dropping the queue enrichment stayed green until this pin
    // existed (component tests drive their own fixtures; the enrichment lives
    // here in the page).
    expect(count("reviewBySourceId.get")).toBeGreaterThanOrEqual(2);
    // The queue map must SET the fields, not merely read the map — a mutant
    // dropping the two field lines (keeping the .get) stayed green under the
    // count pin alone.
    expect(src).toMatch(/rawQueue\.map[\s\S]{0,400}reviewStatus:/);
    expect(src).toMatch(/rawQueue\.map[\s\S]{0,400}docCount:/);
    expect(src).toMatch(/<ReimburseQueue rows=\{reimbursable\} fromHref=/);
    // Queue group names go through the admin seam too (D5 amendment).
    expect(count("resolveUserNames")).toBeGreaterThanOrEqual(2);
  });
});

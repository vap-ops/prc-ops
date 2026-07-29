// Spec 373 D6 — the voucher's back chip is referrer-aware. The page is a
// Server Component vitest cannot render, so the wiring is pinned by source
// scan. The shared MULTI_PARENT_DETAILS guard's toContain("safeBackHref") is
// satisfiable by an import line alone (guard-carries-the-bug lesson), so the
// pins here are the ones that actually bite: use count ≥2 (import PLUS a call)
// and the exact fallback so a crafted ?from= can never redirect off-site.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const src = stripComments(readFileSync("src/app/accounting/review/[source]/[id]/page.tsx", "utf8"));
const count = (needle: string) => src.split(needle).length - 1;

describe("spec 373 D6 — review voucher back chip", () => {
  it("resolves the chip through safeBackHref (import + a real call, not just the import)", () => {
    expect(count("safeBackHref")).toBeGreaterThanOrEqual(2);
  });

  it("keeps /accounting/review as the safe fallback", () => {
    expect(src).toContain('safeBackHref(from, "/accounting/review")');
  });

  it("reads ?from= from searchParams (the page was single-parent before 373)", () => {
    expect(src).toMatch(/const { from } = await searchParams/);
  });

  it("no hardcoded back chip remains", () => {
    expect(src).not.toContain('backHref="/accounting/review"');
  });
});

describe("spec 373 §6 — the verify chain door", () => {
  it("takes the chain target from the LOADER (shared client + error-throw), never a page-side RPC", () => {
    // The pending query lives in loadReviewVoucher — a page-side copy would
    // silently swallow errors as "nothing pending" (fresh-eyes 🟠).
    expect(count("data.nextPendingId")).toBeGreaterThanOrEqual(2);
    expect(src).not.toContain("list_money_events_for_review");
  });

  it("the next door threads the SAME ?from= so the whole chain returns to one origin", () => {
    expect(src).toMatch(/nextHref[\s\S]{0,300}encodeURIComponent\(from\)/);
  });

  it("renders the end state when the chain is dry (a door to nowhere is a dead door)", () => {
    expect(count("REVIEW_CHAIN_DONE")).toBeGreaterThanOrEqual(2);
    expect(count("REVIEW_NEXT_CTA")).toBeGreaterThanOrEqual(2);
  });
});

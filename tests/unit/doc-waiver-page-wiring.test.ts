// Writing failing test first.
//
// Spec 380 U6 — the PAGE-side half. The review voucher is a Server Component
// vitest cannot render, and this repo has twice shipped a page-level gate that
// no component test could see (spec 397 U3/U5). So the wiring is pinned here by
// source scan, with comments stripped FIRST so prose describing a symbol can
// never satisfy the assertion about using it.
//
// The two things that must never regress:
//   1. the panel is ACCOUNTING-ONLY (§2 decision ③) — it sits behind the same
//      MONEY_REVIEW_ROLES gate as the verify/flag actions, not the wider
//      ACCOUNTING_ROLES that may merely READ the voucher;
//   2. it renders only for purchase_requests — a waiver has no meaning for the
//      other 14 money sources, and purchase_doc_waivers.purchase_request_id
//      would not resolve.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PAGE = read("src/app/accounting/review/[source]/[id]/page.tsx");
const ACTIONS = read("src/app/accounting/review/[source]/[id]/actions.ts");

const occurrences = (src: string, needle: string) => src.split(needle).length - 1;

describe("the review voucher wires the waiver panel", () => {
  // >=2 = the import PLUS a real use. A bare toContain is satisfied by the
  // import line alone — the fake-coverage trap this repo keeps re-learning.
  it("renders the panel", () => {
    expect(occurrences(PAGE, "PurchaseDocWaiverPanel")).toBeGreaterThanOrEqual(2);
  });

  it("passes BOTH directions — a waive with no unwaive would strand the state", () => {
    expect(occurrences(PAGE, "waivePurchaseDocsAction")).toBeGreaterThanOrEqual(2);
    expect(occurrences(PAGE, "unwaivePurchaseDocsAction")).toBeGreaterThanOrEqual(2);
  });

  // Anchor on the RENDER site, never the first match — the first
  // "PurchaseDocWaiverPanel" in the file is the import, so a scan anchored
  // there would pass with the panel rendered anywhere at all.
  const panelUse = () => PAGE.lastIndexOf("<PurchaseDocWaiverPanel");

  it("renders it only for purchase_requests", () => {
    const use = panelUse();
    expect(use).toBeGreaterThan(-1);
    const guard = PAGE.lastIndexOf('event.sourceTable === "purchase_requests"', use);
    expect(guard).toBeGreaterThan(-1);
  });

  it("keeps the panel inside the MONEY_REVIEW_ROLES branch, not the read-only one", () => {
    const use = panelUse();
    // The role gate must be re-applied between the source guard and the panel:
    // the section is accounting-only, so it cannot ride on the source test alone.
    const gate = PAGE.lastIndexOf("MONEY_REVIEW_ROLES as readonly string[]", use);
    const guard = PAGE.lastIndexOf('event.sourceTable === "purchase_requests"', use);
    expect(gate).toBeGreaterThan(guard);
    expect(use).toBeGreaterThan(gate);
  });
});

describe("the waiver actions keep the accounting-only gate", () => {
  it("both actions gate on MONEY_REVIEW_ROLES", () => {
    expect(occurrences(ACTIONS, "waivePurchaseDocsAction")).toBeGreaterThanOrEqual(1);
    expect(occurrences(ACTIONS, "unwaivePurchaseDocsAction")).toBeGreaterThanOrEqual(1);
    // Six gated actions now live here: 4 review + 2 waiver.
    expect(occurrences(ACTIONS, "requireActionRole(MONEY_REVIEW_ROLES")).toBe(6);
  });

  it("never reaches for the admin client — the RPC gate reads the AUTHED role", () => {
    expect(ACTIONS).not.toContain("@/lib/db/admin");
  });
});

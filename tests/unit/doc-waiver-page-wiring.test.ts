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

  // ⚠️ "unwaivePurchaseDocsAction" CONTAINS "waivePurchaseDocsAction", so counting
  // the waive symbol also counts every unwaive mention — a count pin passes with
  // the waive import AND its prop both deleted. Worse, the two are structurally
  // assignable (a 1-param fn fits a 3-param slot), so swapping the props
  // typechecks and every mocked component test still passes, while ยกเว้นเอกสาร
  // would call unwaive_purchase_docs and no order could ever be waived.
  // Pin the exact BINDINGS, not the symbol counts.
  // ⚠️ The prop names collide as substrings too — `unwaive={X}` CONTAINS
  // `waive={X}` — so a plain toContain/not.toContain pair is unusable in BOTH
  // directions (the negative fires on the legitimate unwaive binding, and the
  // positive would accept `unwaive={waivePurchaseDocsAction}`). Anchor the waive
  // prop with a `(?<!un)` boundary. This bit me writing the fix for it.
  it("binds each direction to its own action", () => {
    expect(PAGE).toMatch(/(?<!un)waive=\{waivePurchaseDocsAction\}/);
    expect(PAGE).toMatch(/unwaive=\{unwaivePurchaseDocsAction\}/);
    expect(PAGE).not.toMatch(/(?<!un)waive=\{unwaivePurchaseDocsAction\}/);
    expect(PAGE).not.toMatch(/unwaive=\{waivePurchaseDocsAction\}/);
  });

  // Unpinned, this mutates to waiver={null} and typechecks: the recorded reason
  // and actor never render and ยกเลิกการยกเว้น never appears, so a waived order
  // is stuck out of the tab with no way back.
  it("passes the loaded waiver, so the recorded state and its reverse can render", () => {
    expect(PAGE).toContain("waiver={waiver}");
  });

  // Anchor on the RENDER site, never the first match — the first
  // "PurchaseDocWaiverPanel" in the file is the import, so a scan anchored
  // there would pass with the panel rendered anywhere at all.
  const panelUse = () => PAGE.lastIndexOf("<PurchaseDocWaiverPanel");

  // Mutation-proved: a bare lastIndexOf(guard, panel) SURVIVES deleting this
  // guard, because the page already tests the same source ABOVE (the "full
  // purchase document" link) and the scan silently finds THAT one. The window
  // is therefore anchored to the read-only marker that ends the review section,
  // so only a guard belonging to the waiver section can satisfy it.
  it("renders it only for purchase_requests", () => {
    const use = panelUse();
    const anchor = PAGE.indexOf("ดูอย่างเดียว");
    expect(anchor).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(anchor);
    expect(PAGE.slice(anchor, use)).toContain('event.sourceTable === "purchase_requests"');
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

// Spec 380 U6 — the voucher's document LIST is every attachment on the purchase
// request; doc_count is now the class-aware accounting-document test and also
// counts PO-level documents. They can disagree in BOTH directions, and the queue
// chip follows the count — so the page must name which is which, or it silently
// contradicts the chip that sent the accountant to it.
describe("the voucher reconciles its document list with the accounting count", () => {
  it("explains an attachment that is not a valid accounting document", () => {
    expect(PAGE).toContain("DOC_NOT_ACCOUNTING_DOC");
    expect(PAGE).toContain("docs.length > 0 && event.docCount === 0");
  });

  it("says so when the accounting document lives on the purchase order", () => {
    expect(PAGE).toContain("DOC_ON_PURCHASE_ORDER");
    expect(PAGE).toContain("docs.length === 0 && event.docCount > 0");
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

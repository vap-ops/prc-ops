import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The autonomous-build danger-path guard (.github/workflows/ci.yml) FAILS its
// required check — and so HOLDS a PR for the operator's manual merge — when the
// PR touches a protected path. The `deny='...'` regex in that job is the SSOT
// for "what an autonomous PR must never auto-merge".
//
// This test locks src/app/auth/** into that regex. Those are the session-minting
// / LINE-OAuth-callback / login-handoff / logout route handlers; the gap where
// the regex covered src/lib/auth/ but NOT src/app/auth/ let #455 (a session-mint
// route) and #461 (an auth-page CSS fix) auto-merge UNHELD. It also guards
// against the opposite failure — over-broadening the regex so ordinary app
// routes start getting held.

// Vitest runs from the repo root, so the workflow file is a stable relative path.
const ciYml = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

function denyRegex(): RegExp {
  const match = ciYml.match(/deny='([^']+)'/);
  if (!match || !match[1]) {
    throw new Error("could not find deny='...' in the ci.yml danger-path guard");
  }
  return new RegExp(match[1]);
}

describe("danger-path guard deny-regex", () => {
  const deny = denyRegex();

  it("protects the session / OAuth route handlers under src/app/auth/", () => {
    expect(deny.test("src/app/auth/sandbox-link/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/line/callback/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/line/start/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/logout/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/handoff/start/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/handoff/poll/route.ts")).toBe(true);
  });

  it("protects the photo/storage client pipeline (feedback 10a15ebe follow-up)", () => {
    // The photo upload/downscale/offline-queue pipeline and storage bucket helpers
    // are the client side of a security-relevant surface (Storage RLS + append-only
    // photo_logs); a code change there should be operator-reviewed, not auto-merged.
    expect(deny.test("src/lib/photos/upload-queue.ts")).toBe(true);
    expect(deny.test("src/lib/photos/downscale.ts")).toBe(true);
    expect(deny.test("src/components/features/photos/upload-queue-runner.tsx")).toBe(true);
    expect(deny.test("src/lib/storage/buckets.ts")).toBe(true);
  });

  it("protects the money/payroll route surfaces under src/app/ (chip task_4431efbc)", () => {
    // "money/payroll = operator-held" (CLAUDE.md + autonomous-build-fence): the
    // regex held the money LOGIC dirs (src/lib/labor|accounting, src/lib/db/admin)
    // but NOT the money ROUTE pages under src/app/. A page-JSX-only change to a
    // payroll/accounting/expenses route was guard-CLEAN and would AUTO-MERGE
    // (PRs #487/#497/#595 payroll changes only held because they ALSO edited
    // src/lib/labor/*). These are dedicated money surfaces — wages/CSV export, the
    // GL hub (journal/ledger/payables/WHT/retention/billings/revenue money-writes),
    // and office-expense recording — with no innocent content mixed in.
    expect(deny.test("src/app/payroll/page.tsx")).toBe(true);
    expect(deny.test("src/app/payroll/export/route.ts")).toBe(true);
    expect(deny.test("src/app/accounting/page.tsx")).toBe(true);
    expect(deny.test("src/app/accounting/journal/actions.ts")).toBe(true);
    expect(deny.test("src/app/accounting/wht/record-wht-form.tsx")).toBe(true);
    expect(deny.test("src/app/expenses/page.tsx")).toBe(true);
    expect(deny.test("src/app/expenses/actions.ts")).toBe(true);
  });

  it("protects the store-side client Storage-upload helper family (spec 324 U6 blind-spot)", () => {
    // src/lib/store/upload-receipt-flag-photo.ts is a CLIENT helper that writes
    // bytes straight into the pr-attachments Storage bucket (downscale → upload),
    // gated only by Storage-RLS — the exact "client side of a security-relevant
    // surface" that the src/lib/photos/** + src/lib/storage/** holds already cover.
    // It escaped that hold and AUTO-MERGED (#606) purely because it lives in
    // src/lib/store/ (the inventory domain dir), which is substring-distinct from
    // the held src/lib/storage/. Hold the Storage-write helper FAMILY (upload-*) —
    // same blind-spot class as auth #463 / photos #585 / money #596.
    expect(deny.test("src/lib/store/upload-receipt-flag-photo.ts")).toBe(true);
    expect(deny.test("src/lib/store/upload-any-future-storage-helper.ts")).toBe(true);
    // Deliberate scope boundary: the rest of src/lib/store/ is pure inventory
    // logic (no Storage/RLS surface) and must stay auto-mergeable — holding the
    // whole dir would freeze a growing core domain (store-first material flow),
    // the same over-match discipline the /requests/** + WP-page boundaries below
    // enforce.
    expect(deny.test("src/lib/store/incoming.ts")).toBe(false);
    expect(deny.test("src/lib/store/material-log.ts")).toBe(false);
    expect(deny.test("src/lib/store/divert-lines.ts")).toBe(false);
  });

  it("protects the payroll money-logic lib dir src/lib/payroll/ (chip task_a316fac1)", () => {
    // src/lib/payroll/payout-nominee.ts (spec 320) reads workers-PII-walled bank
    // columns through the ADMIN client (RLS bypass) — the exact money/PII logic
    // surface the src/lib/labor/ + src/lib/accounting/ holds already cover. It
    // escaped them purely because it lives in the sibling dir src/lib/payroll/,
    // which the regex never listed — a change there was guard-CLEAN and would
    // AUTO-MERGE. Same blind-spot class as auth #463 / photos #585 / money
    // routes #596 / store uploads #607. Hold the whole dir: everything in it is
    // payroll money domain (no innocent content to over-match).
    expect(deny.test("src/lib/payroll/payout-nominee.ts")).toBe(true);
    expect(deny.test("src/lib/payroll/payout-nominee-path.ts")).toBe(true);
    expect(deny.test("src/lib/payroll/any-future-payroll-module.ts")).toBe(true);
    // Slash boundary: the token must stay `src/lib/payroll/` (dir), never widen
    // to a bare `src/lib/payroll` prefix that would hold unrelated siblings.
    expect(deny.test("src/lib/payroll-report.ts")).toBe(false);
  });

  it("still protects the pre-existing danger paths (no regression)", () => {
    expect(deny.test("src/lib/auth/session.ts")).toBe(true);
    expect(deny.test("src/lib/db/admin.ts")).toBe(true);
    expect(deny.test("supabase/migrations/075999_x.sql")).toBe(true);
    expect(deny.test("src/lib/notifications/outbox.ts")).toBe(true);
    expect(deny.test(".github/workflows/ci.yml")).toBe(true);
    expect(deny.test("CLAUDE.md")).toBe(true);
  });

  it("does NOT over-match benign app routes, lib, or components", () => {
    expect(deny.test("src/app/sa/page.tsx")).toBe(false);
    expect(deny.test("src/app/dashboard/page.tsx")).toBe(false);
    expect(deny.test("src/app/auth-widget/page.tsx")).toBe(false);
    expect(deny.test("src/lib/format.ts")).toBe(false);
    expect(deny.test("src/components/ui/button.tsx")).toBe(false);
    // Deliberate scope boundary: the WP page dir is too broad to hold wholesale
    // (it would freeze every unrelated WP-detail change). The photo pipeline it
    // imports (src/lib/photos/**) IS held, so most photo-write changes are caught.
    expect(
      deny.test("src/app/projects/[projectId]/work-packages/[workPackageId]/capture-sheet.tsx"),
    ).toBe(false);
    // Deliberate money-route boundary: only the money-OPERATION routes
    // (payroll/accounting/expenses) are held. Two neighbours stay auto-mergeable
    // on purpose:
    //  - /requests/reports — READ-ONLY purchasing spend reporting (no money-write),
    //    auto-merged in practice (#592/#593).
    //  - /requests/orders (PO issuance) + /requests/** at large — the core
    //    autonomous-build PROCUREMENT surface (raise→approve→purchase→PO), shipped
    //    code-only and auto-merged across specs 300-323. A PO commits vendor spend,
    //    but its money CONSEQUENCE (GL/AP posting) lives in src/lib/accounting/ +
    //    src/app/accounting/payables, which ARE held; holding /requests/** wholesale
    //    would freeze the primary product surface. Scope confirmed w/ operator.
    expect(deny.test("src/app/requests/reports/page.tsx")).toBe(false);
    expect(deny.test("src/app/requests/reports/register/page.tsx")).toBe(false);
    expect(deny.test("src/app/requests/orders/[poId]/page.tsx")).toBe(false);
    expect(deny.test("src/app/requests/page.tsx")).toBe(false);
  });
});

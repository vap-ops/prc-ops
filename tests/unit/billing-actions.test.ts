// Spec 204 §Tests (TDD, RED first) — the status predicates that gate the billing/
// retention write controls. They mirror the RPC guards (create/certify_client_billing,
// mark_retention_due, release_retention) so the UI only offers a legal action.

import { describe, it, expect } from "vitest";
import {
  canCertifyBilling,
  canMarkRetentionDue,
  canReleaseRetention,
} from "@/lib/accounting/billing-actions";

describe("billing/retention action predicates (spec 204)", () => {
  it("certify is allowed only for a draft or submitted claim", () => {
    expect(canCertifyBilling("draft")).toBe(true);
    expect(canCertifyBilling("submitted")).toBe(true);
    expect(canCertifyBilling("certified")).toBe(false);
    expect(canCertifyBilling("invoiced")).toBe(false);
    expect(canCertifyBilling("paid")).toBe(false);
  });

  it("mark-due is allowed only for a held retention", () => {
    expect(canMarkRetentionDue("held")).toBe(true);
    expect(canMarkRetentionDue("due")).toBe(false);
    expect(canMarkRetentionDue("released")).toBe(false);
    expect(canMarkRetentionDue("forfeited")).toBe(false);
  });

  it("release is allowed for a held or due retention", () => {
    expect(canReleaseRetention("held")).toBe(true);
    expect(canReleaseRetention("due")).toBe(true);
    expect(canReleaseRetention("released")).toBe(false);
    expect(canReleaseRetention("forfeited")).toBe(false);
  });

  it("an unknown status is never actionable", () => {
    expect(canCertifyBilling("weird")).toBe(false);
    expect(canMarkRetentionDue("weird")).toBe(false);
    expect(canReleaseRetention("weird")).toBe(false);
  });
});

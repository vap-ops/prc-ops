// Spec 250 U2 — pure per-งวด rollup + Σ-vs-contract-value warning.
// Writing failing test first.

import { describe, expect, it } from "vitest";
import {
  rollupInstallments,
  installmentSumWarning,
  type InstallmentRow,
  type BillingLite,
} from "@/lib/accounting/contract";

const inst = (id: string, seq: number, amount: number): InstallmentRow => ({
  id,
  seq,
  label: `งวดที่ ${seq}`,
  amount,
  plannedDate: null,
});

const billing = (
  id: string,
  installmentId: string | null,
  gross: number,
  status = "certified",
): BillingLite => ({ id, installmentId, grossAmount: gross, status });

describe("rollupInstallments", () => {
  it("sums billed per งวด and leaves unbilled งวด at zero", () => {
    const rows = rollupInstallments(
      [inst("i1", 1, 200000), inst("i2", 2, 420000)],
      [billing("b1", "i1", 150000), billing("b2", "i1", 50000), billing("b3", null, 99000)],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "i1", seq: 1, amount: 200000, billed: 200000 });
    expect(rows[1]).toMatchObject({ id: "i2", seq: 2, amount: 420000, billed: 0 });
  });

  it("orders by seq regardless of input order", () => {
    const rows = rollupInstallments([inst("i2", 2, 100), inst("i1", 1, 100)], []);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
  });

  it("counts unlinked billings into the unallocated bucket", () => {
    const rows = rollupInstallments([inst("i1", 1, 100)], [billing("b1", null, 40)]);
    expect(rows[0]?.billed).toBe(0);
  });
});

describe("installmentSumWarning", () => {
  it("no warning when Σงวด equals contract value", () => {
    expect(
      installmentSumWarning(620000, [inst("i1", 1, 200000), inst("i2", 2, 420000)]),
    ).toBeNull();
  });

  it("warns with the diff when Σงวด differs", () => {
    const w = installmentSumWarning(620000, [inst("i1", 1, 200000)]);
    expect(w).not.toBeNull();
    expect(w?.sum).toBe(200000);
    expect(w?.diff).toBe(-420000);
  });

  it("no warning when there are no งวด yet (nothing to compare)", () => {
    expect(installmentSumWarning(620000, [])).toBeNull();
  });

  it("tolerates satang rounding within 0.01", () => {
    expect(installmentSumWarning(100, [inst("i1", 1, 99.995)])).toBeNull();
  });
});

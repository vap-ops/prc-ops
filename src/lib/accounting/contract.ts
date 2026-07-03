// Spec 250 U2 — pure per-งวด (contract installment) rollup + the Σ-vs-value
// warning. The chain is documentation, not a gate: an unlinked billing simply
// doesn't count toward any งวด (it still counts at project level — spec 253).

export interface InstallmentRow {
  id: string;
  seq: number;
  label: string;
  amount: number;
  plannedDate: string | null;
}

export interface BillingLite {
  id: string;
  installmentId: string | null;
  grossAmount: number;
  status: string;
}

export interface InstallmentRollupRow extends InstallmentRow {
  billed: number;
}

export function rollupInstallments(
  installments: InstallmentRow[],
  billings: BillingLite[],
): InstallmentRollupRow[] {
  const billedByInstallment = new Map<string, number>();
  for (const b of billings) {
    if (b.installmentId === null) continue;
    billedByInstallment.set(
      b.installmentId,
      (billedByInstallment.get(b.installmentId) ?? 0) + b.grossAmount,
    );
  }
  return [...installments]
    .sort((a, b) => a.seq - b.seq)
    .map((i) => ({ ...i, billed: billedByInstallment.get(i.id) ?? 0 }));
}

export interface InstallmentSumWarning {
  sum: number;
  contractValue: number;
  diff: number;
}

// Σ(งวด) ≠ contract value → warn (never block; Thai contracts vary). No งวด
// rows yet → nothing to compare, no warning. Satang rounding within 0.01 passes.
export function installmentSumWarning(
  contractValue: number,
  installments: InstallmentRow[],
): InstallmentSumWarning | null {
  if (installments.length === 0) return null;
  const sum = installments.reduce((acc, i) => acc + i.amount, 0);
  const diff = sum - contractValue;
  if (Math.abs(diff) < 0.01) return null;
  return { sum, contractValue, diff };
}

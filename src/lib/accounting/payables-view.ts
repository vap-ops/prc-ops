// Spec 196 Tier 2 — pure shaping for the AP subledger (เจ้าหนี้การค้า). AP is GL
// account 2100 with a supplier_id dimension per line; there is no separate AP
// table. This rolls those lines up per supplier into the outstanding balance owed
// = credit − debit (AP is credit-normal: a purchase credits AP, a payment debits
// it). Net-zero suppliers (fully paid) drop out so the register shows live debt.
// Satang-summed to avoid float drift (the accounting-views money convention).

export interface PayableLine {
  supplierId: string | null;
  debit: number;
  credit: number;
}

export interface PayableRow {
  supplierId: string | null;
  balance: number;
}

export interface PayablesAggregate {
  rows: PayableRow[];
  total: number;
}

export function aggregatePayables(lines: PayableLine[]): PayablesAggregate {
  // credit − debit per supplier, in satang. Map keeps a distinct null bucket.
  const satang = new Map<string | null, number>();
  for (const l of lines) {
    const delta = Math.round(l.credit * 100) - Math.round(l.debit * 100);
    satang.set(l.supplierId, (satang.get(l.supplierId) ?? 0) + delta);
  }

  const rows: PayableRow[] = [];
  let totalSatang = 0;
  for (const [supplierId, bal] of satang) {
    if (bal === 0) continue; // fully paid — not outstanding
    rows.push({ supplierId, balance: bal / 100 });
    totalSatang += bal;
  }
  rows.sort((a, b) => b.balance - a.balance);

  return { rows, total: totalSatang / 100 };
}

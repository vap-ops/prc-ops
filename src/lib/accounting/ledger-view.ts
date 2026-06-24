// Spec 196 Tier 1 — pure shaping for the /accounting GL ledger drill. An auditor
// drills a trial-balance account into its journal lines; this gives each line's
// source document a readable Thai label and totals the lines (debit, credit, and
// the net movement = debit − credit). Totals accumulate in integer satang so a
// sum of .01-amounts does not drift on IEEE floats (the money-cents convention
// used across the accounting views).

const SOURCE_LABELS: Record<string, string> = {
  purchase_requests: "ใบขอซื้อ",
  purchase_orders: "ใบสั่งซื้อ",
  stock_receipts: "รับเข้าสต๊อก",
  stock_issues: "เบิกของ",
  stock_counts: "ตรวจนับสต๊อก",
  stock_reversals: "กลับรายการสต๊อก",
  client_billings: "วางบิลลูกค้า",
  retention_receivables: "เงินประกันผลงาน",
  dc_payments: "จ่ายค่าแรงรายวัน",
};

// A source table's display label; the raw table name for an unmapped feed so a
// new posting source still renders (never a blank cell).
export function sourceDocLabel(table: string): string {
  return SOURCE_LABELS[table] ?? table;
}

export interface LedgerLine {
  debit: number;
  credit: number;
}

export interface LedgerSummary {
  totalDebit: number;
  totalCredit: number;
  // Net movement on the account, debit − credit. Positive = net debit (an asset/
  // expense balance), negative = net credit (a liability/income balance, e.g. AP).
  net: number;
}

export function summarizeLedger(rows: LedgerLine[]): LedgerSummary {
  let debitSatang = 0;
  let creditSatang = 0;
  for (const r of rows) {
    debitSatang += Math.round(r.debit * 100);
    creditSatang += Math.round(r.credit * 100);
  }
  return {
    totalDebit: debitSatang / 100,
    totalCredit: creditSatang / 100,
    net: (debitSatang - creditSatang) / 100,
  };
}

// Spec 345 U2 — pure view helpers for the /accounting/review queue.
// The docs-expected CLASSES come from the DB SSOT (money_review_docs_expected,
// returned per row by list_money_events_for_review) — this module only maps
// classes and sources to Thai copy. Do NOT re-derive the class map here.

export const MONEY_SOURCE_TABLES = [
  "purchase_requests",
  "purchase_order_charges",
  "office_expenses",
  "stock_receipts",
  "stock_returns",
  "wage_payments",
  "wp_labor_costs",
  "equipment_rental_batches",
  "rental_charges",
  "rental_settlements",
  "subcontract_payments",
  "client_billings",
  "client_receipts",
  "retention_receivables",
  "wht_certificates",
] as const;

export type MoneySourceTable = (typeof MONEY_SOURCE_TABLES)[number];

const SOURCE_LABELS: Record<MoneySourceTable, string> = {
  purchase_requests: "ใบขอซื้อ",
  purchase_order_charges: "ค่าขนส่ง/ส่วนลด PO",
  office_expenses: "ค่าใช้จ่ายสำนักงาน",
  stock_receipts: "รับของเข้าคลัง",
  stock_returns: "คืนของเข้าคลัง",
  wage_payments: "จ่ายค่าแรง",
  wp_labor_costs: "ต้นทุนแรงงาน (งานย่อย)",
  equipment_rental_batches: "สัญญาเช่าเครื่องจักร",
  rental_charges: "ค่าเช่าเครื่องจักร",
  rental_settlements: "ปิดยอดค่าเช่า",
  subcontract_payments: "จ่ายผู้รับเหมาช่วง",
  client_billings: "งวดงานลูกค้า",
  client_receipts: "รับเงินลูกค้า",
  retention_receivables: "เงินประกันผลงาน",
  wht_certificates: "หนังสือหัก ณ ที่จ่าย",
};

export function moneySourceLabel(source: MoneySourceTable): string {
  return SOURCE_LABELS[source];
}

export type ReviewTabKey = "pending" | "flagged" | "no_docs" | "verified";

export const REVIEW_TABS: ReadonlyArray<{ key: ReviewTabKey; label: string }> = [
  { key: "pending", label: "รอตรวจ" },
  { key: "flagged", label: "ติดธง" },
  { key: "no_docs", label: "ไม่มีเอกสาร" },
  { key: "verified", label: "ตรวจแล้ว" },
];

export function reviewTabLabel(key: ReviewTabKey): string {
  const tab = REVIEW_TABS.find((t) => t.key === key);
  if (!tab) throw new Error(`unknown review tab: ${String(key)}`);
  return tab.label;
}

export type DocsExpectedClass = "expected" | "no_path_yet" | "not_expected";

/**
 * The doc-situation chip for a queue row. Only speaks when it needs attention:
 * an expected-class row without docs gets the actionable chip; a family whose
 * upload path does not exist yet is labeled (not blamed); the labor family is
 * silent — muster is the evidence (spec 345 D2).
 */
export function docsBadgeLabel(row: {
  docsExpected: DocsExpectedClass;
  docCount: number;
}): string | null {
  if (row.docsExpected === "expected") return row.docCount === 0 ? "ไม่มีเอกสาร" : null;
  if (row.docsExpected === "no_path_yet")
    return row.docCount === 0 ? "ยังไม่มีช่องแนบเอกสาร" : null;
  return null;
}

export function reviewStatusLabel(status: "pending" | "flagged" | "verified"): string {
  return reviewTabLabel(status);
}

export type MoneyFlagType =
  | "missing_doc"
  | "wrong_doc_type"
  | "amount_mismatch"
  | "sum_mismatch"
  | "unreadable"
  | "duplicate_doc"
  | "wrong_vendor"
  | "changed_after_verified"
  | "other";

const FLAG_TYPE_LABELS: Record<MoneyFlagType, string> = {
  missing_doc: "ไม่มีเอกสารแนบ",
  wrong_doc_type: "ประเภทเอกสารไม่ถูกต้อง",
  amount_mismatch: "ยอดเงินไม่ตรงเอกสาร",
  sum_mismatch: "รายการรวมไม่เท่ายอด",
  unreadable: "เอกสารอ่านไม่ออก",
  duplicate_doc: "เอกสารซ้ำกับรายการอื่น",
  wrong_vendor: "ชื่อผู้ขายไม่ตรง",
  changed_after_verified: "ข้อมูลเปลี่ยนหลังตรวจแล้ว",
  other: "อื่น ๆ",
};

export function flagTypeLabel(type: MoneyFlagType): string {
  return FLAG_TYPE_LABELS[type];
}

/** The types an admin can raise — changed_after_verified is system-reserved. */
export const ADMIN_FLAG_TYPES: ReadonlyArray<Exclude<MoneyFlagType, "changed_after_verified">> = [
  "missing_doc",
  "wrong_doc_type",
  "amount_mismatch",
  "sum_mismatch",
  "unreadable",
  "duplicate_doc",
  "wrong_vendor",
  "other",
];

// FB-4620 — the enriched itemized purchase-line CSV export (pure layer). The
// summary export (reportRowsToCsv, purchase-report-view.ts) emits bucket×group
// AGGREGATE rows; procurement asked for the ordered ITEMS (ชื่อ + จำนวน + ราคา)
// so they can plan the next project of the same client. This file is IO-free:
// one row per purchase_requests line, Thai headers, UTF-8 BOM so Excel opens Thai
// clean (the payroll/summary-export precedent). The loader that fills these rows
// with parity to the summary lives in load-purchase-line-items.ts.
//
// Money facts (verified against the purchase_report RPC + vat.ts): `amount` is the
// GROSS (VAT-inclusive) line total, `vatRate` is a percent (7, not 0.07), and a
// NULL amount means no price was captured (site/staff PRs) — shown BLANK, never a
// fake 0.00, so a planner never mistakes an uncosted line for a zero-cost one.

import { deriveVatBreakdown } from "@/lib/purchasing/vat";
import { formatThaiDate } from "@/lib/i18n/labels";
import { formatPoNumber, formatPrNumber } from "@/lib/purchasing/format-id";
import { purchaseStatusLabel } from "@/lib/accounting/purchases-view";

/** One ordered line, resolved to human labels by the loader. */
export interface PurchaseLineExportRow {
  purchasedAt: string | null;
  projectName: string;
  projectCode: string;
  /** "" when the line is ad-hoc / its catalog item is uncategorised. */
  categoryName: string;
  categoryCode: string;
  itemName: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  /** GROSS (VAT-inclusive) line total; null = no price captured. */
  amount: number | null;
  /** VAT rate as a percent (e.g. 7). */
  vatRate: number;
  supplierName: string;
  poNumber: number | null;
  prNumber: number;
  /** "" when the line has no work package. */
  wpName: string;
  wpCode: string;
  neededBy: string | null;
  deliveredAt: string | null;
  status: string;
}

/** Thai column headers, in emission order. Kept in sync with the row map below;
 * the export test pins the count. */
export const PURCHASE_LINE_EXPORT_HEADER: readonly string[] = [
  "วันที่จัดซื้อ",
  "โครงการ",
  "รหัสโครงการ",
  "หมวดวัสดุ",
  "รหัสหมวด",
  "ชื่อสินค้า",
  "รายละเอียด",
  "จำนวน",
  "หน่วย",
  "ราคาต่อหน่วย (รวมภาษี)",
  "ราคาที่สั่ง (รวมภาษี)",
  "อัตราภาษี (%)",
  "มูลค่าก่อนภาษี",
  "ภาษีมูลค่าเพิ่ม",
  "ผู้ขาย",
  "เลขที่ใบสั่งซื้อ",
  "เลขที่ใบขอซื้อ",
  "Work Package",
  "รหัส WP",
  "วันที่ต้องการ",
  "วันที่รับของ",
  "สถานะ",
];

/** Quote only cells that would otherwise break CSV parsing (quote/comma/newline),
 * doubling embedded quotes — the reportRowsToCsv convention (csvCell), reimplemented
 * here to keep the two exports decoupled. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Neutralize CSV formula injection: a cell a spreadsheet would treat as a formula
 * (starts with = + - @ TAB CR) is prefixed with an apostrophe so Excel/Sheets render
 * it as literal text. Applied to FREE-TEXT (user-entered) cells only — never to the
 * numeric/date/id cells this module formats itself (amounts/quantities are
 * non-negative, so a leading '-' never occurs there and would corrupt a real value). */
function text(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Raw numeric cells (`.toFixed(2)`), NOT baht() — machine-parseable, no ฿/commas,
 * matching the summary export so Excel reads the numbers as numbers. */
const money = (n: number): string => n.toFixed(2);

const dateOrBlank = (iso: string | null): string => (iso ? formatThaiDate(iso) : "");

export function purchaseLineItemsToCsv(rows: ReadonlyArray<PurchaseLineExportRow>): string {
  const lines: string[] = [PURCHASE_LINE_EXPORT_HEADER.join(",")];
  for (const r of rows) {
    const priced = r.amount !== null;
    const gross = r.amount ?? 0;
    const { net, vat } = priced ? deriveVatBreakdown(gross, r.vatRate) : { net: 0, vat: 0 };
    const unitPrice = priced && r.quantity !== 0 ? gross / r.quantity : null;
    lines.push(
      [
        dateOrBlank(r.purchasedAt),
        text(r.projectName),
        text(r.projectCode),
        text(r.categoryName),
        text(r.categoryCode),
        text(r.itemName),
        text(r.itemDescription),
        String(r.quantity),
        text(r.unit),
        unitPrice !== null ? money(unitPrice) : "",
        priced ? money(gross) : "",
        String(r.vatRate),
        priced ? money(net) : "",
        priced ? money(vat) : "",
        text(r.supplierName),
        r.poNumber !== null ? formatPoNumber(r.poNumber) : "",
        formatPrNumber(r.prNumber),
        text(r.wpName),
        text(r.wpCode),
        dateOrBlank(r.neededBy),
        dateOrBlank(r.deliveredAt),
        purchaseStatusLabel(r.status),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\n") + "\n";
}

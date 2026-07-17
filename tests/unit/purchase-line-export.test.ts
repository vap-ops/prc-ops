// Writing failing test first.
//
// FB-4620 — the enriched itemized purchase-line CSV export. The summary export
// (reportRowsToCsv) emits bucket×group aggregate rows; procurement asked for the
// ordered ITEMS (ชื่อ + จำนวน + ราคา) to plan the next project of the same client.
// This is the pure formatting layer: one row per purchase_requests line. Money
// facts already verified against the schema/RPC: `amount` is the GROSS (VAT-
// inclusive) line total, `vat_rate` is a percent (7, not 0.07), and null amount
// means no price was captured (site/staff PRs) — the export must show that as
// BLANK, never a fake 0.00.
import { describe, expect, it } from "vitest";
import {
  PURCHASE_LINE_EXPORT_HEADER,
  purchaseLineItemsToCsv,
  type PurchaseLineExportRow,
} from "@/lib/purchasing/purchase-line-export";
import { formatThaiDate } from "@/lib/i18n/labels";

const col = (name: string) => PURCHASE_LINE_EXPORT_HEADER.indexOf(name);

// A fully-specified, catalog-linked, priced line.
const rowA: PurchaseLineExportRow = {
  purchasedAt: "2026-07-01",
  projectName: "อาคารเอ",
  projectCode: "PRC-01",
  categoryName: "เหล็ก",
  categoryCode: "S",
  itemName: "เหล็กเส้น RB9",
  itemDescription: "เหล็กเส้นกลม RB9 ยาว 10ม.",
  quantity: 100,
  unit: "เส้น",
  amount: 5350,
  vatRate: 7,
  supplierName: "ร้านเหล็กดี",
  poNumber: 12,
  prNumber: 7,
  wpName: "งานโครงสร้าง",
  wpCode: "STR",
  neededBy: "2026-07-05",
  deliveredAt: "2026-07-03",
  status: "delivered",
};

// An ad-hoc (no catalog), UNPRICED, no-PO, no-WP site purchase.
const rowB: PurchaseLineExportRow = {
  purchasedAt: "2026-07-02",
  projectName: "อาคารเอ",
  projectCode: "PRC-01",
  categoryName: "",
  categoryCode: "",
  itemName: "ค่าน้ำมันเครื่องจักร",
  itemDescription: "ค่าน้ำมันเครื่องจักร",
  quantity: 1,
  unit: "ครั้ง",
  amount: null,
  vatRate: 0,
  supplierName: "ไม่ระบุผู้ขาย",
  poNumber: null,
  prNumber: 8,
  wpName: "",
  wpCode: "",
  neededBy: null,
  deliveredAt: null,
  status: "site_purchased",
};

describe("purchaseLineItemsToCsv (FB-4620 itemized export)", () => {
  it("prefixes a UTF-8 BOM so Excel opens Thai clean", () => {
    expect(purchaseLineItemsToCsv([rowA]).charAt(0)).toBe("﻿");
  });

  it("emits the enriched Thai header row (22 columns)", () => {
    const csv = purchaseLineItemsToCsv([]);
    const lines = csv.slice(1).trimEnd().split("\n");
    expect(lines[0]).toBe(PURCHASE_LINE_EXPORT_HEADER.join(","));
    expect(PURCHASE_LINE_EXPORT_HEADER).toHaveLength(22);
    // header only when there are no rows
    expect(lines).toHaveLength(1);
  });

  it("maps a priced, catalog-linked line: gross unit price, VAT split, PR/PO, status, dates", () => {
    const csv = purchaseLineItemsToCsv([rowA]);
    const fields = csv.slice(1).trimEnd().split("\n")[1]!.split(",");
    expect(fields[col("วันที่จัดซื้อ")]).toBe(formatThaiDate("2026-07-01"));
    expect(fields[col("โครงการ")]).toBe("อาคารเอ");
    expect(fields[col("รหัสโครงการ")]).toBe("PRC-01");
    expect(fields[col("หมวดวัสดุ")]).toBe("เหล็ก");
    expect(fields[col("รหัสหมวด")]).toBe("S");
    expect(fields[col("ชื่อสินค้า")]).toBe("เหล็กเส้น RB9");
    expect(fields[col("จำนวน")]).toBe("100");
    expect(fields[col("หน่วย")]).toBe("เส้น");
    // gross unit price = amount / quantity = 5350 / 100
    expect(fields[col("ราคาต่อหน่วย (รวมภาษี)")]).toBe("53.50");
    // ราคาที่สั่ง = gross line total
    expect(fields[col("ราคาที่สั่ง (รวมภาษี)")]).toBe("5350.00");
    expect(fields[col("อัตราภาษี (%)")]).toBe("7");
    // net = 5350 / 1.07 = 5000.00 ; vat = 350.00 (deriveVatBreakdown SSOT)
    expect(fields[col("มูลค่าก่อนภาษี")]).toBe("5000.00");
    expect(fields[col("ภาษีมูลค่าเพิ่ม")]).toBe("350.00");
    expect(fields[col("ผู้ขาย")]).toBe("ร้านเหล็กดี");
    expect(fields[col("เลขที่ใบสั่งซื้อ")]).toBe("PO-0012");
    expect(fields[col("เลขที่ใบขอซื้อ")]).toBe("PR-0007");
    expect(fields[col("Work Package")]).toBe("งานโครงสร้าง");
    expect(fields[col("รหัส WP")]).toBe("STR");
    expect(fields[col("วันที่ต้องการ")]).toBe(formatThaiDate("2026-07-05"));
    expect(fields[col("วันที่รับของ")]).toBe(formatThaiDate("2026-07-03"));
    expect(fields[col("สถานะ")]).toBe("รับของแล้ว");
  });

  it("leaves money cells BLANK for an unpriced line (null amount ≠ fake 0), and blanks empty PO/WP/dates", () => {
    const csv = purchaseLineItemsToCsv([rowB]);
    const fields = csv.slice(1).trimEnd().split("\n")[1]!.split(",");
    expect(fields[col("ราคาต่อหน่วย (รวมภาษี)")]).toBe("");
    expect(fields[col("ราคาที่สั่ง (รวมภาษี)")]).toBe("");
    expect(fields[col("มูลค่าก่อนภาษี")]).toBe("");
    expect(fields[col("ภาษีมูลค่าเพิ่ม")]).toBe("");
    expect(fields[col("หมวดวัสดุ")]).toBe("");
    expect(fields[col("เลขที่ใบสั่งซื้อ")]).toBe("");
    expect(fields[col("เลขที่ใบขอซื้อ")]).toBe("PR-0008");
    expect(fields[col("Work Package")]).toBe("");
    expect(fields[col("วันที่ต้องการ")]).toBe("");
    expect(fields[col("วันที่รับของ")]).toBe("");
    expect(fields[col("สถานะ")]).toBe("ซื้อหน้างาน");
  });

  it("quotes cells containing a comma so columns never shift", () => {
    const csv = purchaseLineItemsToCsv([{ ...rowA, itemDescription: "ท่อ PVC, ข้อต่อ" }]);
    // the raw description with an embedded comma must be wrapped in quotes
    expect(csv).toContain('"ท่อ PVC, ข้อต่อ"');
  });

  it("neutralizes CSV formula injection in free-text cells (Excel is the target)", () => {
    const csv = purchaseLineItemsToCsv([
      { ...rowA, itemName: "=cmd|'/c calc'!A1", supplierName: "@evil", unit: "-x" },
    ]);
    const fields = csv.slice(1).trimEnd().split("\n")[1]!.split(",");
    // a leading =/@/- on a text cell is prefixed with an apostrophe → literal text
    expect(fields[col("ชื่อสินค้า")]!.startsWith("'=")).toBe(true);
    expect(fields[col("ผู้ขาย")]).toBe("'@evil");
    expect(fields[col("หน่วย")]).toBe("'-x");
    // numeric cells this module formats are never guarded (would corrupt the value)
    expect(fields[col("ราคาที่สั่ง (รวมภาษี)")]).toBe("5350.00");
  });

  it("emits one CSV row per line item", () => {
    const csv = purchaseLineItemsToCsv([rowA, rowB]);
    const lines = csv.slice(1).trimEnd().split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
  });
});

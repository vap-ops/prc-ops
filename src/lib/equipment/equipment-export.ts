// Spec 367 U2 — the equipment registry CSV export (pure layer, no IO).
//
// This file has two jobs at once, which is why its column list is a CONTRACT
// rather than UI copy:
//
//   1. It is the **PRI transfer schedule** (spec 367 §3). PRC is selling all 64
//      items to a sister company and renting them back, and this is the document
//      that says what is being sold.
//   2. Round-tripped, it is the **U3 import template**. Export → fill the blanks
//      in Excel/Sheets → paste back. There is deliberately no separate empty
//      template file: two artifacts would drift, and then a column the operator
//      filled would silently fail to import.
//
// Because of (2), every importable column here must map 1:1 to something U3 can
// write back, and the two read-only columns are marked as such.
//
// MONEY: `acquisition_cost` and `daily_rate` are zero-authenticated-grant (ADR
// 0055 decision 6). The caller passes `includeMoney` after gating, and a
// non-money audience gets a file with those COLUMNS ABSENT — not blank. A blank
// price column in a transfer schedule reads as "free"; an absent one reads as
// "not your view", which is the truth.

import { csvCell, csvFilename, csvNumber, toCsvBody } from "@/lib/csv";
import {
  EQUIPMENT_CONDITION_LABEL,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_TRACKING_LABEL,
} from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

export interface EquipmentExportRow {
  /** Blank on import = INSERT, filled = UPDATE that row. The round-trip key. */
  id: string;
  name: string;
  categoryName: string;
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  assetTag: string | null;
  tracking: Enums["equipment_tracking"];
  quantity: number | null;
  condition: Enums["equipment_condition"] | null;
  status: Enums["equipment_status"];
  ownerName: string | null;
  supplierName: string | null;
  acquiredAt: string | null;
  /** MONEY — only rendered when includeMoney. */
  acquisitionCost: number | null;
  /** MONEY — only rendered when includeMoney. */
  dailyRate: number | null;
  /** READ-ONLY: derived from equipment_movements, never importable. */
  locationLabel: string;
  description: string | null;
  /** READ-ONLY: images cannot ride in a CSV (spec 367 §7). */
  hasImage: boolean;
}

/** The non-money column contract. Order is part of it. */
export const EQUIPMENT_EXPORT_HEADER = [
  "รหัสอ้างอิง",
  "ชื่อ",
  "หมวดหมู่",
  "ยี่ห้อ",
  "รุ่น",
  "หมายเลขเครื่อง",
  "ป้ายทรัพย์สิน",
  "การติดตาม",
  "จำนวน",
  "สภาพ",
  "สถานะ",
  "เจ้าของ",
  "ผู้ขาย",
  "วันที่ได้มา",
  "ที่ตั้งปัจจุบัน",
  "รายละเอียด",
  "มีรูป",
] as const;

/**
 * The money audience's contract: the same columns plus ราคาทุน / ค่าเช่า/วัน,
 * inserted after วันที่ได้มา so the acquisition facts sit together.
 */
export const EQUIPMENT_EXPORT_HEADER_WITH_MONEY = [
  ...EQUIPMENT_EXPORT_HEADER.slice(0, 14),
  "ราคาทุน",
  "ค่าเช่า/วัน",
  ...EQUIPMENT_EXPORT_HEADER.slice(14),
] as const;

export function toEquipmentCsv(
  rows: readonly EquipmentExportRow[],
  options: { includeMoney: boolean },
): string {
  const header = options.includeMoney
    ? EQUIPMENT_EXPORT_HEADER_WITH_MONEY
    : EQUIPMENT_EXPORT_HEADER;

  const lines = rows.map((r) =>
    [
      csvCell(r.id),
      csvCell(r.name),
      csvCell(r.categoryName),
      csvCell(r.brand ?? ""),
      csvCell(r.model ?? ""),
      csvCell(r.serialNo ?? ""),
      csvCell(r.assetTag ?? ""),
      csvCell(EQUIPMENT_TRACKING_LABEL[r.tracking]),
      csvNumber(r.quantity),
      csvCell(r.condition ? EQUIPMENT_CONDITION_LABEL[r.condition] : ""),
      csvCell(EQUIPMENT_STATUS_LABEL[r.status]),
      csvCell(r.ownerName ?? ""),
      csvCell(r.supplierName ?? ""),
      csvCell(r.acquiredAt ?? ""),
      ...(options.includeMoney ? [csvNumber(r.acquisitionCost), csvNumber(r.dailyRate)] : []),
      csvCell(r.locationLabel),
      csvCell(r.description ?? ""),
      r.hasImage ? "ใช่" : "",
    ].join(","),
  );

  return toCsvBody(header, lines);
}

export function equipmentCsvFilename(isoDate: string): string {
  return csvFilename("equipment", isoDate);
}

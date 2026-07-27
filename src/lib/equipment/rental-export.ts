// Spec 367 U2 — the inbound rental-agreement CSV export (pure layer, no IO).
//
// `equipment_rental_batches` is the list of things PRC rents IN — a tractor, a
// room, plant it does not own. It carries **no item dimension at all**: the
// "what" lives only in free-text `note`, and 20 of the 29 live rows have that
// blank (spec 361). This export makes that emptiness visible in a spreadsheet
// rather than leaving it buried, and round-tripped it is the U4 import template.
//
// No per-column money gate here, unlike the equipment export: the whole
// /equipment/rentals surface is already BACK_OFFICE_ROLES-gated, so a reader of
// this file is by definition a money audience.

import { csvCell, csvFilename, csvNumber, toCsvBody } from "@/lib/csv";
import { EQUIPMENT_RATE_PERIOD_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

const RENTAL_STATUS_LABEL: Record<Enums["rental_agreement_status"], string> = {
  active: "กำลังเช่า",
  returned: "คืนแล้ว",
  settled: "ปิดบัญชีแล้ว",
  cancelled: "ยกเลิก",
};

export interface RentalExportRow {
  /** Blank on import = INSERT, filled = UPDATE. The round-trip key. */
  id: string;
  ownerName: string | null;
  supplierName: string | null;
  /** The only place the rented THING is named today. Blank on 20 of 29 rows. */
  note: string | null;
  rate: number;
  ratePeriod: Enums["equipment_rate_period"];
  startsOn: string;
  endsOn: string | null;
  minRentalDays: number | null;
  depositAmount: number;
  depositPaidDate: string | null;
  status: Enums["rental_agreement_status"];
}

export const RENTAL_EXPORT_HEADER = [
  "รหัสอ้างอิง",
  "ผู้ให้เช่า",
  "ผู้ขาย",
  "รายการ",
  "อัตรา",
  "หน่วยอัตรา",
  "เริ่ม",
  "สิ้นสุด",
  "ขั้นต่ำ(วัน)",
  "เงินมัดจำ",
  "วันจ่ายมัดจำ",
  "สถานะ",
] as const;

export function toRentalCsv(rows: readonly RentalExportRow[]): string {
  const lines = rows.map((r) =>
    [
      csvCell(r.id),
      csvCell(r.ownerName ?? ""),
      csvCell(r.supplierName ?? ""),
      // Deliberately blank when absent — no "ไม่ระบุ" placeholder. The gap is the
      // finding; papering over it would hide what spec 361 exists to fix.
      csvCell(r.note ?? ""),
      csvNumber(r.rate),
      csvCell(EQUIPMENT_RATE_PERIOD_LABEL[r.ratePeriod]),
      csvCell(r.startsOn),
      csvCell(r.endsOn ?? ""),
      csvNumber(r.minRentalDays),
      csvNumber(r.depositAmount),
      csvCell(r.depositPaidDate ?? ""),
      csvCell(RENTAL_STATUS_LABEL[r.status]),
    ].join(","),
  );

  return toCsvBody(RENTAL_EXPORT_HEADER, lines);
}

export function rentalCsvFilename(isoDate: string): string {
  return csvFilename("equipment-rentals", isoDate);
}

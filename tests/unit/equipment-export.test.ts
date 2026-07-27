// Spec 367 U2 — the equipment + rental CSV exports.
//
// These files are the PRI transfer schedule (spec 367 §3) and, round-tripped,
// the U3 import template. So the column list is a CONTRACT, not UI copy: it is
// pinned here so a label tweak on /equipment can never silently reshape a file
// the operator is filling in offline or handing to a sister company.
//
// The money split is the load-bearing rule. `acquisition_cost` and `daily_rate`
// are zero-authenticated-grant (ADR 0055 decision 6) — a site_admin export must
// not carry them, and must not carry an empty COLUMN for them either, since a
// blank price column in a transfer schedule reads as "free", not "withheld".

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_EXPORT_HEADER,
  EQUIPMENT_EXPORT_HEADER_WITH_MONEY,
  equipmentCsvFilename,
  toEquipmentCsv,
  type EquipmentExportRow,
} from "@/lib/equipment/equipment-export";
import {
  RENTAL_EXPORT_HEADER,
  rentalCsvFilename,
  toRentalCsv,
  type RentalExportRow,
} from "@/lib/equipment/rental-export";

const row = (over: Partial<EquipmentExportRow> = {}): EquipmentExportRow => ({
  id: "e1",
  name: "เครื่องตบดิน MARTON",
  categoryName: "เครื่องจักรก่อสร้าง",
  brand: "MARTON",
  model: "MT-65",
  serialNo: "SN-001",
  assetTag: "PRC-014",
  tracking: "unit",
  quantity: null,
  condition: "good",
  status: "available",
  ownerName: "Prestion Construction Co., Ltd.",
  supplierName: "Prestion Construction Co., Ltd.",
  acquiredAt: "2025-03-04",
  acquisitionCost: 48000,
  dailyRate: 350,
  locationLabel: "รับเข้าคลัง",
  description: "เครื่องยนต์เบนซิน",
  hasImage: true,
  ...over,
});

describe("equipment CSV export (spec 367 U2)", () => {
  it("emits the agreed header and one line per item", () => {
    const csv = toEquipmentCsv([row(), row({ id: "e2", name: "โม่ผสมปูนฉาก" })], {
      includeMoney: true,
    });
    const lines = csv.replace("﻿", "").trimEnd().split("\n");
    expect(lines[0]).toBe(EQUIPMENT_EXPORT_HEADER_WITH_MONEY.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("เครื่องตบดิน MARTON");
    expect(lines[2]).toContain("โม่ผสมปูนฉาก");
  });

  it("starts with a UTF-8 BOM so Excel renders Thai instead of mojibake", () => {
    expect(toEquipmentCsv([row()], { includeMoney: true }).startsWith("﻿")).toBe(true);
  });

  // THE money gate. Not just blank cells — the columns are absent entirely.
  it("OMITS the money columns for an audience without the money grant", () => {
    const csv = toEquipmentCsv([row()], { includeMoney: false });
    const header = csv.replace("﻿", "").split("\n")[0] ?? "";
    expect(header).toBe(EQUIPMENT_EXPORT_HEADER.join(","));
    expect(header).not.toContain("ราคาทุน");
    expect(header).not.toContain("ค่าเช่า/วัน");
    expect(csv).not.toContain("48000");
    expect(csv).not.toContain("350");
  });

  it("includes the money columns when the audience has the grant", () => {
    const csv = toEquipmentCsv([row()], { includeMoney: true });
    expect(csv).toContain("ราคาทุน");
    expect(csv).toContain("48000");
  });

  // A blank is NOT a zero: 0/64 of these are filled today, and a fake 0.00 in a
  // transfer schedule would price an asset at nothing.
  it("renders an unknown cost as BLANK, never 0", () => {
    const csv = toEquipmentCsv([row({ acquisitionCost: null, dailyRate: null })], {
      includeMoney: true,
    });
    const cells = csv.replace("﻿", "").split("\n")[1]?.split(",") ?? [];
    expect(cells).not.toContain("0");
    expect(cells).not.toContain("0.00");
  });

  it("maps enums through the Thai label SSOT, not raw values", () => {
    const csv = toEquipmentCsv([row()], { includeMoney: false });
    expect(csv).toContain("พร้อมใช้งาน");
    expect(csv).toContain("ดี");
    expect(csv).not.toContain("available");
    expect(csv).not.toContain("needs_repair");
  });

  // Excel/Sheets evaluate a cell starting = + - @ as a formula, and `name`,
  // `brand` and `description` are all operator-editable free text.
  it("defuses a formula-injection payload in operator-editable text", () => {
    const csv = toEquipmentCsv([row({ name: '=HYPERLINK("http://evil","x")' })], {
      includeMoney: false,
    });
    expect(csv).toContain("\"'=HYPERLINK");
  });

  it("quotes a value containing a comma so the columns do not shift", () => {
    const csv = toEquipmentCsv([row({ description: "หนัก 65 กก., เบนซิน" })], {
      includeMoney: false,
    });
    expect(csv).toContain('"หนัก 65 กก., เบนซิน"');
  });

  it("names the file so it sorts by date", () => {
    expect(equipmentCsvFilename("2026-07-27")).toBe("equipment-20260727.csv");
  });
});

describe("rental CSV export (spec 367 U2)", () => {
  const rental = (over: Partial<RentalExportRow> = {}): RentalExportRow => ({
    id: "r1",
    ownerName: "ห้างหุ้นส่วน ก",
    supplierName: null,
    note: "เช่ารถแม็คโคร PC 140",
    rate: 1164,
    ratePeriod: "monthly",
    startsOn: "2026-06-22",
    endsOn: null,
    minRentalDays: null,
    depositAmount: 0,
    depositPaidDate: null,
    status: "active",
    ...over,
  });

  it("emits the agreed header and one line per agreement", () => {
    const csv = toRentalCsv([rental(), rental({ id: "r2", note: null })]);
    const lines = csv.replace("﻿", "").trimEnd().split("\n");
    expect(lines[0]).toBe(RENTAL_EXPORT_HEADER.join(","));
    expect(lines).toHaveLength(3);
  });

  it("maps the rate period through the label SSOT", () => {
    expect(toRentalCsv([rental()])).toContain("ต่อเดือน");
  });

  // 20 of 29 live rows have a blank note — the whole reason spec 361 exists. The
  // file must show that emptiness plainly rather than inventing a placeholder.
  it("leaves a missing รายการ blank rather than inventing text", () => {
    const csv = toRentalCsv([rental({ note: null })]);
    expect(csv).not.toContain("ไม่ระบุ");
    expect(csv).not.toContain("null");
  });

  it("names the file so it sorts by date", () => {
    expect(rentalCsvFilename("2026-07-27")).toBe("equipment-rentals-20260727.csv");
  });
});

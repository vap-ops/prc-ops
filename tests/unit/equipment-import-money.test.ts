// Spec 367 §10.4 (second half) — the importer stops refusing money.
//
// Until now a filled ราคาทุน / วันที่ได้มา / ค่าเช่า cell was REFUSED, and the
// refusal was right: none of the three could be written. All three now have a
// DEFINER seam (`set_equipment_acquisition` from #1027, `set_equipment_daily_rate`
// since spec 202), so the file may carry them.
//
// ⚠️ The two RPCs do NOT share a blank-cell rule, and that is the whole risk:
//   * `set_equipment_acquisition` accepts null and CLEARS.
//   * `set_equipment_daily_rate` REFUSES null (P0001), so a blank rate cannot
//     mean clear — it can only mean "leave it alone".
// One blank cell would therefore mean two different things in one row. The
// parser resolves it by reporting what the cell SAYS (a value, or blank) and
// leaving the meaning to the caller, which knows the current values; these pin
// that the parser never collapses the two.

import { describe, expect, it } from "vitest";

import {
  parseEquipmentImport,
  type EquipmentImportContext,
} from "@/lib/equipment/equipment-import";
import { EQUIPMENT_STATUS_LABEL, EQUIPMENT_TRACKING_LABEL } from "@/lib/i18n/labels";

const ID = "11111111-2222-4333-8444-555555555555";

const ctx: EquipmentImportContext = {
  categoriesByName: new Map([["เครื่องมือช่างทั่วไป", "c1"]]),
  ownersByName: new Map([["PRI", "o1"]]),
  existingIds: new Set([ID]),
  allowMoney: true,
};

const HEAD =
  "รหัสอ้างอิง\tชื่อ\tหมวดหมู่\tการติดตาม\tจำนวน\tสถานะ\tเจ้าของ\tวันที่ได้มา\tราคาทุน\tค่าเช่า/วัน";
// Labels come from the labels.ts SSOT, not retyped: the importer maps the Thai
// label back to the enum, so a hand-typed variant tests a file nobody exports.
const row = (acquiredAt: string, cost: string, rate: string) =>
  `${ID}\tสว่าน No.1\tเครื่องมือช่างทั่วไป\t${EQUIPMENT_TRACKING_LABEL.unit}\t\t${EQUIPMENT_STATUS_LABEL.available}\tPRI\t${acquiredAt}\t${cost}\t${rate}`;

describe("parseEquipmentImport — money columns", () => {
  it("accepts a filled cost and acquisition date instead of refusing them", () => {
    const result = parseEquipmentImport(`${HEAD}\n${row("2025-03-04", "12500.50", "")}`, ctx);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      acquisitionCost: 12500.5,
      acquiredAt: "2025-03-04",
    });
  });

  it("accepts a filled daily rate", () => {
    const result = parseEquipmentImport(`${HEAD}\n${row("", "", "300")}`, ctx);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ dailyRate: 300 });
  });

  it("reports a BLANK money cell as null — the caller decides what blank means", () => {
    // Blank cost/date will CLEAR (the RPC accepts null); a blank rate will be
    // LEFT ALONE (its RPC refuses null). The parser must not bake either in.
    const result = parseEquipmentImport(`${HEAD}\n${row("", "", "")}`, ctx);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      acquisitionCost: null,
      acquiredAt: null,
      dailyRate: null,
    });
  });

  it("still refuses a non-numeric cost or rate", () => {
    expect(parseEquipmentImport(`${HEAD}\n${row("", "หมื่นห้า", "")}`, ctx).errors.length).toBe(1);
    expect(parseEquipmentImport(`${HEAD}\n${row("", "", "สามร้อย")}`, ctx).errors.length).toBe(1);
  });

  it("still refuses a negative cost or rate — the RPCs raise P0001 on both", () => {
    expect(parseEquipmentImport(`${HEAD}\n${row("", "-1", "")}`, ctx).errors.length).toBe(1);
    expect(parseEquipmentImport(`${HEAD}\n${row("", "", "-5")}`, ctx).errors.length).toBe(1);
  });

  it("still refuses a malformed acquisition date", () => {
    const result = parseEquipmentImport(`${HEAD}\n${row("04/03/2025", "", "")}`, ctx);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("ปี-เดือน-วัน");
  });

  // ⚠️ "Tomorrow" must be computed in BANGKOK, not UTC. A UTC now+24h can still
  // be the same civil day in Bangkok (the box and the DB run in UTC, the users
  // are at UTC+7), so a naive fixture makes this pass or fail by wall clock.
  it("refuses a future acquisition date before the round trip", () => {
    const bangkokTomorrow = new Date(Date.now() + (7 + 24) * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = parseEquipmentImport(`${HEAD}\n${row(bangkokTomorrow, "", "")}`, ctx);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("อนาคต");
  });

  it("accepts TODAY in Bangkok — the boundary the UTC clock gets wrong", () => {
    const bangkokToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = parseEquipmentImport(`${HEAD}\n${row(bangkokToday, "", "")}`, ctx);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.acquiredAt).toBe(bangkokToday);
  });

  // The header gate is unchanged and still load-bearing: a non-money audience
  // exports a file WITHOUT these columns, so receiving them means the file is
  // not theirs. Now that the columns are writable this matters MORE, not less.
  it("still refuses the whole file when a non-money audience sends money columns", () => {
    const result = parseEquipmentImport(`${HEAD}\n${row("", "1", "1")}`, {
      ...ctx,
      allowMoney: false,
    });

    expect(result.rows).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

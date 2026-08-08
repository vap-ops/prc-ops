// Spec 367 §13 — the bulk add paste's parser.
//
// What must hold and why:
//   * The FIRST column is the ทะเบียน SKU name, resolved and never created. That
//     is what keeps this door from reversing spec 385 U4: an instance is still
//     born from the catalog, so the NOT NULL `equipment_catalog_item_id` is
//     satisfied by construction rather than by a new escape hatch.
//   * `จำนวน` means two different things by tracking (N machines to create vs the
//     one bulk row's quantity), so the parser must emit the EFFECT in words for
//     the preview — a value with two meanings is only safe if the reader is told
//     which one applies before anything is written.
//   * Unit names continue the crew's stencil numbering from the SKU's LIVE count,
//     exactly as the add sheet derives them.
//   * A second bulk row is refused at parse time, so the file never discovers the
//     partial unique index (mig 075891) the hard way.
//   * Blank เจ้าของ falls to the default owner and blank ที่ตั้ง falls to คลัง —
//     the two answers that are the same for ~every row of a real sheet.

import { describe, expect, it } from "vitest";

import { parseBulkEquipmentAdd, type BulkAddContext } from "@/lib/equipment/bulk-add-parse";
import { STORE_LOCATION } from "@/lib/equipment/initial-location";

const PRI = "a43fdea5-4e94-4065-9ac7-182da0692348";
const PCC = "b43fdea5-4e94-4065-9ac7-182da0692349";
const PROJECT = "a88af871-019b-4eca-a7aa-f05244c83e5d";
const SKU_DRILL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const SKU_HOSE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const SKU_OFF = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3";

const ctx: BulkAddContext = {
  skusByName: new Map([
    [
      "สว่านไฟฟ้า",
      {
        id: SKU_DRILL,
        categoryId: "c1",
        brand: "MAKITA",
        model: null,
        defaultTracking: "unit",
        isActive: true,
        instanceCount: 2,
      },
    ],
    [
      "สายยางวัดระดับน้ำ",
      {
        id: SKU_HOSE,
        categoryId: "c1",
        brand: null,
        model: null,
        defaultTracking: "bulk",
        isActive: true,
        instanceCount: 0,
      },
    ],
    [
      "เครื่องเก่า",
      {
        id: SKU_OFF,
        categoryId: "c1",
        brand: null,
        model: null,
        defaultTracking: "unit",
        isActive: false,
        instanceCount: 0,
      },
    ],
  ]),
  ownersByName: new Map([
    ["Preston International Co., Ltd.", PRI],
    ["Preston Construction Co., Ltd.", PCC],
  ]),
  defaultOwnerId: PRI,
  projectsByName: new Map([["TFM นายาว เพชรบูรณ์", PROJECT]]),
};

const HEADER = "ทะเบียน\tจำนวน\tเจ้าของ\tที่ตั้ง";

describe("parseBulkEquipmentAdd", () => {
  it("creates N unit instances continuing the SKU's live numbering", () => {
    const result = parseBulkEquipmentAdd(`${HEADER}\nสว่านไฟฟ้า\t3\t\t`, ctx);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        catalogItemId: SKU_DRILL,
        skuName: "สว่านไฟฟ้า",
        categoryId: "c1",
        brand: "MAKITA",
        model: null,
        tracking: "unit",
        instances: 3,
        quantity: null,
        firstNumber: 3,
        ownerId: PRI,
        location: STORE_LOCATION,
        effect: "สร้าง 3 เครื่อง (สว่านไฟฟ้า No.3–No.5) · รับเข้าคลัง",
      },
    ]);
    expect(result.unitsToCreate).toBe(3);
  });

  it("makes ONE row for a bulk SKU and reads จำนวน as that row's quantity", () => {
    const result = parseBulkEquipmentAdd(`${HEADER}\nสายยางวัดระดับน้ำ\t200\t\t`, ctx);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      tracking: "bulk",
      instances: 1,
      quantity: 200,
      effect: "1 แถว จำนวน 200 · รับเข้าคลัง",
    });
    expect(result.unitsToCreate).toBe(1);
  });

  it("resolves a named owner and a named project", () => {
    const result = parseBulkEquipmentAdd(
      `${HEADER}\nสว่านไฟฟ้า\t1\tPreston Construction Co., Ltd.\tTFM นายาว เพชรบูรณ์`,
      ctx,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      ownerId: PCC,
      location: PROJECT,
      effect: "สร้าง 1 เครื่อง (สว่านไฟฟ้า No.3) · หน้างาน: TFM นายาว เพชรบูรณ์",
    });
  });

  it("refuses an unknown SKU rather than inventing one", () => {
    const result = parseBulkEquipmentAdd(`${HEADER}\nสว่านลม\t1\t\t`, ctx);

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("สว่านลม");
    expect(result.errors.join(" ")).toContain("ทะเบียน");
  });

  it("refuses an INACTIVE SKU — it is off the catalog on purpose", () => {
    const result = parseBulkEquipmentAdd(`${HEADER}\nเครื่องเก่า\t1\t\t`, ctx);

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("ปิดใช้งาน");
  });

  it("refuses a second bulk row for a SKU that already owns one, naming แก้ไข", () => {
    const taken: BulkAddContext = {
      ...ctx,
      skusByName: new Map(ctx.skusByName).set("สายยางวัดระดับน้ำ", {
        id: SKU_HOSE,
        categoryId: "c1",
        brand: null,
        model: null,
        defaultTracking: "bulk",
        isActive: true,
        instanceCount: 1,
      }),
    };
    const result = parseBulkEquipmentAdd(`${HEADER}\nสายยางวัดระดับน้ำ\t5\t\t`, taken);

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("แก้ไข");
  });

  it("refuses the same SKU twice in one file — the second row's numbering is stale", () => {
    const result = parseBulkEquipmentAdd(`${HEADER}\nสว่านไฟฟ้า\t1\t\t\nสว่านไฟฟ้า\t2\t\t`, ctx);

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("ซ้ำ");
  });

  it("refuses a quantity that is blank, zero, negative or fractional", () => {
    for (const qty of ["", "0", "-2", "1.5", "สาม"]) {
      const result = parseBulkEquipmentAdd(`${HEADER}\nสว่านไฟฟ้า\t${qty}\t\t`, ctx);
      expect(result.rows, `qty=${qty}`).toEqual([]);
      expect(result.errors.length, `qty=${qty}`).toBeGreaterThan(0);
    }
  });

  it("refuses an unknown owner and an unknown location by name", () => {
    const owner = parseBulkEquipmentAdd(`${HEADER}\nสว่านไฟฟ้า\t1\tบริษัทไม่มีจริง\t`, ctx);
    expect(owner.errors.join(" ")).toContain("บริษัทไม่มีจริง");

    const loc = parseBulkEquipmentAdd(`${HEADER}\nสว่านไฟฟ้า\t1\t\tไซต์ไม่มีจริง`, ctx);
    expect(loc.errors.join(" ")).toContain("ไซต์ไม่มีจริง");
  });

  it("refuses when no default owner exists rather than guessing one", () => {
    const noDefault: BulkAddContext = { ...ctx, defaultOwnerId: null };
    const result = parseBulkEquipmentAdd(`${HEADER}\nสว่านไฟฟ้า\t1\t\t`, noDefault);

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("เจ้าของ");
  });

  it("refuses a derived name that would exceed the 120-char column cap", () => {
    const longName = "ก".repeat(118);
    const long: BulkAddContext = {
      ...ctx,
      skusByName: new Map(ctx.skusByName).set(longName, {
        id: SKU_DRILL,
        categoryId: "c1",
        brand: null,
        model: null,
        defaultTracking: "unit",
        isActive: true,
        instanceCount: 0,
      }),
    };
    const result = parseBulkEquipmentAdd(`${HEADER}\n${longName}\t2\t\t`, long);

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("ยาวเกินไป");
  });

  it("collects EVERY bad row, not just the first — the sheet is fixed offline", () => {
    const result = parseBulkEquipmentAdd(
      `${HEADER}\nสว่านลม\t1\t\t\nสว่านไฟฟ้า\t0\t\t\nเครื่องเก่า\t1\t\t`,
      ctx,
    );

    expect(result.errors.length).toBe(3);
  });

  it("reads a comma-delimited paste as well as a TAB one", () => {
    const result = parseBulkEquipmentAdd("ทะเบียน,จำนวน,เจ้าของ,ที่ตั้ง\nสว่านไฟฟ้า,1,,", ctx);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.instances).toBe(1);
  });

  it("says so when the paste carries only a header", () => {
    const result = parseBulkEquipmentAdd(HEADER, ctx);

    expect(result.rows).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

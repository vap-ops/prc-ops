// Spec 385 U2 — the pick-from-ทะเบียน helpers: unit auto-naming and the
// category-grouped SKU options the add sheet renders.
//
// Naming is the contract the operator stated ("เครื่องตบดิน is supposed to be
// only 1 in ทะเบียน" — units are เครื่องตบดิน No.1, No.2…): the instance name is
// DERIVED from the SKU, never typed, so the free-text duplicate disease cannot
// return through the pick path.

import { describe, expect, it } from "vitest";

import {
  nextUnitName,
  groupSkusByCategory,
  type CatalogSkuOption,
} from "@/lib/equipment/catalog-pick";

const sku = (over: Partial<CatalogSkuOption>): CatalogSkuOption => ({
  id: "s1",
  name: "เครื่องตบดิน",
  categoryId: "c1",
  brand: null,
  model: null,
  defaultTracking: "unit",
  ...over,
});

describe("nextUnitName", () => {
  it("numbers the first unit No.1", () => {
    expect(nextUnitName("เครื่องตบดิน", 0)).toBe("เครื่องตบดิน No.1");
  });

  it("continues the crew's numbering from the existing count", () => {
    expect(nextUnitName("เครื่องเชื่อมไฟฟ้า", 2)).toBe("เครื่องเชื่อมไฟฟ้า No.3");
  });

  it("trims the SKU name so a stray space cannot fork the family", () => {
    expect(nextUnitName("  ระดับน้ำ ", 0)).toBe("ระดับน้ำ No.1");
  });
});

describe("groupSkusByCategory", () => {
  const categories = [
    { id: "c1", name: "เครื่องจักรก่อสร้าง" },
    { id: "c2", name: "เครื่องมือตัดและเจียร" },
    { id: "c3", name: "เครื่องวัด" },
  ];

  it("groups in the categories prop's order and drops empty groups", () => {
    const groups = groupSkusByCategory(
      [
        sku({ id: "s1", categoryId: "c2", name: "เลื่อยไฟฟ้า" }),
        sku({ id: "s2", categoryId: "c1", name: "เครื่องตบดิน" }),
        sku({ id: "s3", categoryId: "c2", name: "เครื่องเจียรไฟฟ้า ขนาด 4 นิ้ว" }),
      ],
      categories,
    );

    expect(groups.map((g) => g.name)).toEqual(["เครื่องจักรก่อสร้าง", "เครื่องมือตัดและเจียร"]);
    expect(groups[1]?.skus.map((s) => s.name)).toEqual([
      "เลื่อยไฟฟ้า",
      "เครื่องเจียรไฟฟ้า ขนาด 4 นิ้ว",
    ]);
  });

  it("parks a SKU whose category is unknown in a trailing อื่น ๆ group instead of dropping it", () => {
    const groups = groupSkusByCategory([sku({ id: "s9", categoryId: "GONE" })], categories);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("อื่น ๆ");
    expect(groups[0]?.skus.map((s) => s.id)).toEqual(["s9"]);
  });
});

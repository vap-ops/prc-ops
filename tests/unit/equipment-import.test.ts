// Spec 367 U3 — the equipment CSV importer (pure parse + validate, no IO).
//
// The load-bearing test in this file is the ROUND TRIP: the U2 exporter's own
// output must parse back cleanly. Export and import are two halves of ONE
// contract — the operator's workflow is "download → fill the blanks in Sheets →
// paste back" — and nothing else would catch the two drifting apart, because
// each half is internally consistent on its own.
//
// The other rules exist because of what the data looks like today: 0/64 items
// have a cost, 5/64 have an asset tag, and the category list already contains
// one badly-named row (spec 367 §1.4). An importer that silently creates
// taxonomy rows, or writes a blank as 0, would turn a typo into permanent data.

import { describe, expect, it } from "vitest";
import { toEquipmentCsv, type EquipmentExportRow } from "@/lib/equipment/equipment-export";
import {
  parseEquipmentImport,
  type EquipmentImportContext,
} from "@/lib/equipment/equipment-import";

const CATEGORY_ID = "c0000000-0000-4000-8000-000000000001";
const OWNER_ID = "b0000000-0000-4000-8000-000000000001";
const EXISTING_ID = "e0000000-0000-4000-8000-000000000001";

const ctx = (over: Partial<EquipmentImportContext> = {}): EquipmentImportContext => ({
  categoriesByName: new Map([["เครื่องจักรก่อสร้าง", CATEGORY_ID]]),
  ownersByName: new Map([["Prestion Construction Co., Ltd.", OWNER_ID]]),
  existingIds: new Set([EXISTING_ID]),
  allowMoney: true,
  ...over,
});

const HEADER =
  "รหัสอ้างอิง,ชื่อ,หมวดหมู่,ยี่ห้อ,รุ่น,หมายเลขเครื่อง,ป้ายทรัพย์สิน,การติดตาม,จำนวน,สภาพ,สถานะ,เจ้าของ,ผู้ขาย,วันที่ได้มา,ราคาทุน,ค่าเช่า/วัน,ที่ตั้งปัจจุบัน,รายละเอียด,มีรูป";

const cellsOf = (over: Record<string, string> = {}): string[] => {
  const cells: Record<string, string> = {
    // Spec 385 U4: the default fixture row is an UPDATE — the blank-id insert
    // arm is retired (instances are born from the ทะเบียน), so a blank default
    // would make every unrelated case red on the refusal instead of its own
    // concern. The refusal itself is pinned in its dedicated case.
    id: EXISTING_ID,
    name: "เครื่องตบดิน",
    category: "เครื่องจักรก่อสร้าง",
    brand: "MARTON",
    model: "MT-65",
    serial: "SN-1",
    tag: "PRC-01",
    tracking: "รายชิ้น (มีรหัส)",
    qty: "",
    condition: "ดี",
    status: "พร้อมใช้งาน",
    owner: "Prestion Construction Co., Ltd.",
    supplier: "",
    acquiredAt: "",
    cost: "",
    rate: "",
    location: "—",
    description: "",
    hasImage: "",
    ...over,
  };
  return [
    cells.id,
    cells.name,
    cells.category,
    cells.brand,
    cells.model,
    cells.serial,
    cells.tag,
    cells.tracking,
    cells.qty,
    cells.condition,
    cells.status,
    cells.owner,
    cells.supplier,
    cells.acquiredAt,
    cells.cost,
    cells.rate,
    cells.location,
    cells.description,
    cells.hasImage,
  ].map((v) => v ?? "");
};

// Quote like the exporter does. The owner name `Prestion Construction Co., Ltd.`
// CONTAINS a comma, so any test doing string surgery on an already-joined line
// (`split(",")`, `replaceAll(",", "\t")`) corrupts it and stops testing a real
// file. Build from CELLS and join once — this suite caught that mistake twice.
const q = (v: string): string => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const line = (over: Record<string, string> = {}): string => cellsOf(over).map(q).join(",");

const csv = (...rows: string[]): string => [HEADER, ...rows].join("\n");

describe("equipment import — the round trip with the exporter", () => {
  // If this breaks, the operator's actual workflow is broken: they downloaded a
  // file, typed into the blanks, and pasted it back.
  it("parses the EXPORTER's own output without a single error", () => {
    const exported: EquipmentExportRow = {
      id: EXISTING_ID,
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
      acquiredAt: null,
      // Blank, as all 64 live rows are — money is read-only on import.
      acquisitionCost: null,
      dailyRate: null,
      locationLabel: "รับเข้าคลัง",
      description: "เครื่องยนต์เบนซิน",
      hasImage: true,
    };
    const result = parseEquipmentImport(toEquipmentCsv([exported], { includeMoney: true }), ctx());

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.kind).toBe("update");
    expect(row.id).toBe(EXISTING_ID);
    expect(row.name).toBe("เครื่องตบดิน MARTON");
    expect(row.categoryId).toBe(CATEGORY_ID);
    expect(row.ownerId).toBe(OWNER_ID);
    expect(row.tracking).toBe("unit");
    expect(row.condition).toBe("good");
    expect(row.status).toBe("available");
    // Pinned because typecheck, not this suite, caught `COL.description` being
    // absent from the column map — every description was silently importing as
    // null while every other assertion here still passed.
    expect(row.description).toBe("เครื่องยนต์เบนซิน");
    expect(row.brand).toBe("MARTON");
    expect(row.serialNo).toBe("SN-001");
    expect(row.assetTag).toBe("PRC-014");
  });
});

describe("equipment import — insert vs update", () => {
  // Spec 385 U4: the INSERT arm is retired — instances are born from the
  // ทะเบียน (U2), and the NOT NULL SKU FK (mig 075891) would refuse a file-born
  // row anyway. The file is the bulk EDITOR for rows that exist.
  it("REFUSES a blank id — new machines are added through the ทะเบียน, not a file", () => {
    const r = parseEquipmentImport(csv(line({ id: "" })), ctx());
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("ทะเบียน");
    expect(r.rows).toEqual([]);
    expect(r.inserts).toBe(0);
  });

  it("treats a KNOWN id as an update", () => {
    const r = parseEquipmentImport(csv(line({ id: EXISTING_ID })), ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.kind).toBe("update");
    expect(r.updates).toBe(1);
  });

  // An unrecognised id means the operator edited the key column or pasted a row
  // from another environment. Inserting would silently duplicate the asset.
  it("REFUSES an unknown id rather than inserting it", () => {
    const r = parseEquipmentImport(
      csv(line({ id: "e0000000-0000-4000-8000-000000000999" })),
      ctx(),
    );
    expect(r.rows).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("แถว 1");
  });

  it("refuses the same id twice in one file", () => {
    const r = parseEquipmentImport(
      csv(line({ id: EXISTING_ID }), line({ id: EXISTING_ID })),
      ctx(),
    );
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("equipment import — taxonomy is resolved, never invented", () => {
  it("resolves category and owner by NAME", () => {
    const r = parseEquipmentImport(csv(line()), ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.categoryId).toBe(CATEGORY_ID);
    expect(r.rows[0]?.ownerId).toBe(OWNER_ID);
  });

  // Spec 275 id-mirrors an owner into suppliers and the write path sets
  // supplier_id = owner_id, so a differing ผู้ขาย could never land. Refusing beats
  // accepting an edit that would be silently overwritten on save.
  it("REFUSES a ผู้ขาย that differs from เจ้าของ", () => {
    const r = parseEquipmentImport(csv(line({ supplier: "คนละบริษัท" })), ctx());
    expect(r.rows).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("ผู้ขาย");
  });

  it("accepts a ผู้ขาย equal to เจ้าของ (what the exporter emits)", () => {
    const r = parseEquipmentImport(
      csv(line({ supplier: "Prestion Construction Co., Ltd." })),
      ctx(),
    );
    expect(r.errors).toEqual([]);
  });

  // Auto-creating is how `งานวัสดุพื้นฐานโครงสร้าง` happens again — a typo
  // becomes a permanent taxonomy row nobody notices until an audit.
  it("REFUSES an unknown category instead of creating one", () => {
    const r = parseEquipmentImport(csv(line({ category: "หมวดที่พิมพ์ผิด" })), ctx());
    expect(r.rows).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("หมวดที่พิมพ์ผิด");
  });

  it("REFUSES an unknown owner instead of creating one", () => {
    const r = parseEquipmentImport(csv(line({ owner: "บริษัทที่ไม่มีอยู่" })), ctx());
    expect(r.rows).toHaveLength(0);
  });
});

describe("equipment import — enums come from the Thai label SSOT", () => {
  it("maps Thai labels back to enum values", () => {
    const r = parseEquipmentImport(
      csv(
        line({
          tracking: "จำนวนมาก (นับจำนวน)",
          qty: "12",
          tag: "",
          condition: "ต้องซ่อม",
          status: "ซ่อมบำรุง",
        }),
      ),
      ctx(),
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.tracking).toBe("bulk");
    expect(r.rows[0]?.quantity).toBe(12);
    expect(r.rows[0]?.condition).toBe("needs_repair");
    expect(r.rows[0]?.status).toBe("maintenance");
  });

  it("refuses an unrecognised status label", () => {
    const r = parseEquipmentImport(csv(line({ status: "ไม่รู้จัก" })), ctx());
    expect(r.errors.join(" ")).toContain("ไม่รู้จัก");
  });

  it("accepts a blank condition (it is optional)", () => {
    const r = parseEquipmentImport(csv(line({ condition: "" })), ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.condition).toBeNull();
  });
});

describe("equipment import — the money gate mirrors the export", () => {
  // The export DROPS these columns for a non-money audience; the import must
  // refuse them from the same audience, or the gate is one-directional.
  it("REFUSES money columns when the importer is not a money audience", () => {
    const r = parseEquipmentImport(csv(line({ cost: "48000" })), ctx({ allowMoney: false }));
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.rows).toHaveLength(0);
  });

  it("accepts a file WITHOUT the money columns from a non-money audience", () => {
    const headerCells = HEADER.split(",");
    headerCells.splice(14, 2);
    const dataCells = cellsOf();
    dataCells.splice(14, 2);
    const r = parseEquipmentImport(
      [headerCells.join(","), dataCells.map(q).join(",")].join("\n"),
      ctx({ allowMoney: false }),
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });

  // ⚠️ REVERSED 2026-08-08 (spec 367 §10.4, second half), deliberately — the old
  // assertions are kept in words below because the REASON they existed is the
  // reason they could stop existing. Money was read-only on import because
  // `acquisition_cost` had no write path in the app AT ALL and `acquired_at`
  // carried no grant; refusing a filled cell beat writing everything except the
  // prices. Both now go through their own SECURITY DEFINER RPC, so the file may
  // carry them and the refusal would now be the defect.
  //
  // What did NOT change: the header-level audience gate above (a non-money
  // audience sending money columns still fails the whole file), and the table's
  // money wall — the importer never writes these columns directly.
  it("ACCEPTS a filled cost now that a write path exists", () => {
    const r = parseEquipmentImport(csv(line({ cost: "48000" })), ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.acquisitionCost).toBe(48000);
  });

  it("ACCEPTS a filled rate", () => {
    const r = parseEquipmentImport(csv(line({ rate: "350" })), ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.dailyRate).toBe(350);
  });

  it("ACCEPTS a filled acquired-on date", () => {
    const r = parseEquipmentImport(csv(line({ acquiredAt: "2025-03-04" })), ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.acquiredAt).toBe("2025-03-04");
  });

  it("accepts the blank money columns the live export actually produces", () => {
    const r = parseEquipmentImport(csv(line()), ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });

  it("still refuses a non-numeric cost rather than coercing it", () => {
    const r = parseEquipmentImport(csv(line({ cost: "ประมาณ 48000" })), ctx());
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("equipment import — shape and invariants", () => {
  // The operator works from a cloud PC; pasting straight out of Google Sheets
  // gives TAB-delimited text with no file round trip.
  it("accepts a TAB-delimited Google-Sheets paste", () => {
    // Built from CELLS, not by replacing commas in a joined line — the owner
    // name contains a comma, so the naive form corrupts it.
    const tabbed = [HEADER.split(",").join("\t"), cellsOf().join("\t")].join("\n");
    const r = parseEquipmentImport(tabbed, ctx());
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });

  it("enforces the unit/bulk invariants (a unit item cannot carry a quantity)", () => {
    const r = parseEquipmentImport(csv(line({ tracking: "รายชิ้น (มีรหัส)", qty: "5" })), ctx());
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("requires a name", () => {
    const r = parseEquipmentImport(csv(line({ name: "  " })), ctx());
    expect(r.errors.join(" ")).toContain("แถว 1");
  });

  it("ignores the two READ-ONLY columns rather than trying to write them", () => {
    const r = parseEquipmentImport(
      csv(line({ location: "หน้างาน: อะไรก็ได้", hasImage: "ใช่" })),
      ctx(),
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).not.toHaveProperty("locationLabel");
    expect(r.rows[0]).not.toHaveProperty("hasImage");
  });

  it("reports EVERY bad row, not just the first", () => {
    const r = parseEquipmentImport(
      csv(line({ name: "" }), line({ category: "ไม่มีหมวดนี้" }), line({ status: "มั่วมาก" })),
      ctx(),
    );
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    expect(r.rows).toHaveLength(0);
  });

  it("returns nothing to write when the file is only a header", () => {
    const r = parseEquipmentImport(HEADER, ctx());
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});

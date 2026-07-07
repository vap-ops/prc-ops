import { describe, expect, it } from "vitest";

import {
  buildGroupingTemplate,
  parseGroupingTemplate,
  toExistingWp,
  toRpcRows,
  validateGrouping,
  type ExistingWp,
} from "@/lib/work-packages/grouping-import";

// Spec 270 U2a — engineer template parse + validation + diff plan (pure layer).
// Template columns: SubOf | WP (new code) | OldCode (join key) | ชื่องาน.
// Grouping is MANDATORY (spec §2 D6): a leaf row without SubOf is an ERROR.

const existing: ExistingWp[] = [
  { code: "WP-001", name: "งานหาพิกัด", isGroup: false, parentCode: null },
  { code: "WP-002", name: "งานทำไฟฟ้าชั่วคราว", isGroup: false, parentCode: null },
  { code: "WP-003", name: "งานทำประปาชั่วคราว", isGroup: false, parentCode: null },
];

const header = "SubOf\tWP\tOldCode\tชื่องาน";

function tsv(...lines: string[]): string {
  return [header, ...lines].join("\n");
}

const goodText = tsv(
  "\tWP-101\t\tงานเตรียมพื้นที่",
  "WP-101\tWP-102\tWP-001\tงานหาพิกัด",
  "WP-101\tWP-103\tWP-002\tงานทำไฟฟ้าชั่วคราว (แก้ชื่อ)",
  "WP-101\tWP-104\tWP-003\tงานทำประปาชั่วคราว",
);

describe("parseGroupingTemplate", () => {
  it("parses header + rows, trimming cells", () => {
    const { rows, errors } = parseGroupingTemplate(goodText);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      subOf: null,
      code: "WP-101",
      oldCode: null,
      name: "งานเตรียมพื้นที่",
    });
    expect(rows[1]).toEqual({
      subOf: "WP-101",
      code: "WP-102",
      oldCode: "WP-001",
      name: "งานหาพิกัด",
    });
  });

  it("skips blank lines and accepts a missing header", () => {
    const { rows, errors } = parseGroupingTemplate(
      "\tWP-101\t\tกลุ่ม\n\n\nWP-101\tWP-102\tWP-001\tงาน",
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it("reports rows with the wrong column count", () => {
    const { errors } = parseGroupingTemplate(tsv("WP-101\tWP-102\tงานขาดคอลัมน์"));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/4 columns/);
  });

  it("reports a row with an empty WP code or empty name", () => {
    const { errors } = parseGroupingTemplate(tsv("\t\t\tกลุ่มไม่มีโค้ด", "\tWP-105\tWP-001\t"));
    expect(errors).toHaveLength(2);
  });
});

describe("validateGrouping", () => {
  it("accepts a complete grouping and plans the diff", () => {
    const { rows } = parseGroupingTemplate(goodText);
    const res = validateGrouping(rows, existing);
    expect(res.errors).toEqual([]);
    expect(res.plan).not.toBeNull();
    expect(res.plan?.groupsToCreate).toEqual([{ code: "WP-101", name: "งานเตรียมพื้นที่" }]);
    expect(res.plan?.parented).toBe(3);
    expect(res.plan?.reparented).toBe(0);
    expect(res.plan?.recoded).toEqual([
      { oldCode: "WP-001", to: "WP-102" },
      { oldCode: "WP-002", to: "WP-103" },
      { oldCode: "WP-003", to: "WP-104" },
    ]);
    expect(res.plan?.renamed).toEqual([
      { oldCode: "WP-002", from: "งานทำไฟฟ้าชั่วคราว", to: "งานทำไฟฟ้าชั่วคราว (แก้ชื่อ)" },
    ]);
  });

  it("rejects a leaf without SubOf (grouping is mandatory)", () => {
    const { rows } = parseGroupingTemplate(
      tsv(
        "\tWP-101\t\tกลุ่ม",
        "\tWP-102\tWP-001\tงานหาพิกัด",
        "WP-101\tWP-103\tWP-002\tง2",
        "WP-101\tWP-104\tWP-003\tง3",
      ),
    );
    const res = validateGrouping(rows, existing);
    expect(res.plan).toBeNull();
    expect(res.errors.some((e) => e.code === "WP-102" && /SubOf/.test(e.message))).toBe(true);
  });

  it("rejects SubOf pointing at a row that is not a group in the file", () => {
    const { rows } = parseGroupingTemplate(
      tsv(
        "\tWP-101\t\tกลุ่ม",
        "WP-101\tWP-102\tWP-001\tง1",
        "WP-102\tWP-103\tWP-002\tง2",
        "WP-101\tWP-104\tWP-003\tง3",
      ),
    );
    const res = validateGrouping(rows, existing);
    expect(res.errors.some((e) => e.code === "WP-103" && /group/i.test(e.message))).toBe(true);
  });

  it("rejects duplicate new codes and duplicate OldCodes", () => {
    const { rows } = parseGroupingTemplate(
      tsv(
        "\tWP-101\t\tกลุ่ม",
        "WP-101\tWP-102\tWP-001\tง1",
        "WP-101\tWP-102\tWP-002\tง2",
        "WP-101\tWP-103\tWP-001\tง3",
      ),
    );
    const res = validateGrouping(rows, existing);
    expect(res.errors.some((e) => /duplicate WP code/i.test(e.message))).toBe(true);
    expect(res.errors.some((e) => /duplicate OldCode/i.test(e.message))).toBe(true);
  });

  it("rejects an unknown OldCode and a dropped existing WP", () => {
    const { rows } = parseGroupingTemplate(
      tsv(
        "\tWP-101\t\tกลุ่ม",
        "WP-101\tWP-102\tWP-999\tงานปริศนา",
        "WP-101\tWP-103\tWP-002\tง2",
        "WP-101\tWP-104\tWP-003\tง3",
      ),
    );
    const res = validateGrouping(rows, existing);
    expect(res.errors.some((e) => /WP-999/.test(e.message))).toBe(true);
    expect(res.errors.some((e) => /WP-001/.test(e.message) && /missing/i.test(e.message))).toBe(
      true,
    );
  });

  it("rejects a group row whose OldCode points at an existing leaf (is_group is immutable)", () => {
    const { rows } = parseGroupingTemplate(
      tsv(
        "\tWP-101\tWP-001\tกลุ่มจากงานย่อย",
        "WP-101\tWP-102\tWP-002\tง2",
        "WP-101\tWP-103\tWP-003\tง3",
      ),
    );
    const res = validateGrouping(rows, existing);
    expect(res.errors.some((e) => e.code === "WP-101" && /งานย่อย|leaf/i.test(e.message))).toBe(
      true,
    );
  });

  it("re-import: matches an existing group by OldCode and counts reparents", () => {
    const withGroup: ExistingWp[] = [
      { code: "WP-101", name: "กลุ่มเดิม", isGroup: true, parentCode: null },
      { code: "WP-102", name: "งานหนึ่ง", isGroup: false, parentCode: "WP-101" },
      { code: "WP-103", name: "งานสอง", isGroup: false, parentCode: null },
    ];
    const { rows } = parseGroupingTemplate(
      tsv(
        "\tWP-201\tWP-101\tกลุ่มเดิม",
        "\tWP-202\t\tกลุ่มใหม่",
        "WP-201\tWP-203\tWP-102\tงานหนึ่ง",
        "WP-202\tWP-204\tWP-103\tงานสอง",
      ),
    );
    const res = validateGrouping(rows, withGroup);
    expect(res.errors).toEqual([]);
    expect(res.plan?.groupsMatched).toEqual([{ oldCode: "WP-101", code: "WP-201" }]);
    expect(res.plan?.groupsToCreate).toEqual([{ code: "WP-202", name: "กลุ่มใหม่" }]);
    expect(res.plan?.parented).toBe(1); // WP-103 gains its first parent
    expect(res.plan?.reparented).toBe(0); // WP-102 stays under the same (matched) group
  });

  it("warns (not errors) on a childless group and an odd code format", () => {
    const { rows } = parseGroupingTemplate(
      tsv(
        "\tWP-101\t\tกลุ่มว่าง",
        "\tG-9\t\tกลุ่มโค้ดแปลก",
        "G-9\tWP-102\tWP-001\tง1",
        "G-9\tWP-103\tWP-002\tง2",
        "G-9\tWP-104\tWP-003\tง3",
      ),
    );
    const res = validateGrouping(rows, existing);
    expect(res.errors).toEqual([]);
    expect(
      res.warnings.some((w) => w.code === "WP-101" && /childless|no งานย่อย/i.test(w.message)),
    ).toBe(true);
    expect(res.warnings.some((w) => w.code === "G-9" && /format/i.test(w.message))).toBe(true);
  });
});

describe("toExistingWp", () => {
  it("maps DB rows to ExistingWp with parentCode resolved via the id map", () => {
    const out = toExistingWp([
      { id: "g1", code: "WP-101", name: "กลุ่ม", is_group: true, parent_id: null },
      { id: "l1", code: "WP-001", name: "งาน", is_group: false, parent_id: "g1" },
      { id: "l2", code: "WP-002", name: "งานสอง", is_group: false, parent_id: null },
    ]);
    expect(out).toEqual([
      { code: "WP-101", name: "กลุ่ม", isGroup: true, parentCode: null },
      { code: "WP-001", name: "งาน", isGroup: false, parentCode: "WP-101" },
      { code: "WP-002", name: "งานสอง", isGroup: false, parentCode: null },
    ]);
  });
});

describe("toRpcRows", () => {
  it("maps parsed rows to the RPC's snake_case payload", () => {
    const { rows } = parseGroupingTemplate(goodText);
    expect(toRpcRows(rows)[0]).toEqual({
      sub_of: null,
      code: "WP-101",
      old_code: null,
      name: "งานเตรียมพื้นที่",
    });
    expect(toRpcRows(rows)[1]).toEqual({
      sub_of: "WP-101",
      code: "WP-102",
      old_code: "WP-001",
      name: "งานหาพิกัด",
    });
  });
});

describe("buildGroupingTemplate", () => {
  it("exports header + one pre-filled row per existing WP (OldCode = current code)", () => {
    const out = buildGroupingTemplate(existing);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe(header);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("\tWP-001\tWP-001\tงานหาพิกัด");
  });

  it("round-trips: template output parses clean", () => {
    const { rows, errors } = parseGroupingTemplate(buildGroupingTemplate(existing));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
  });
});

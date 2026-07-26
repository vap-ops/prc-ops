// Spec 361 U8 — the หน่วยนับ curation screen.
//
// The managed list (`catalog_units`, spec 223 / ADR 0066) has had three DEFINER
// CRUD RPCs since it was created, and they already admit procurement_manager —
// but ZERO callers, so nobody could add a unit in the app. Meanwhile the
// deliberate `อื่น ๆ (ระบุเอง)` escape hatch let free text through: 18 distinct
// off-list strings sit on 33 live items, including `ปิีป` for ปี๊บ.
//
// So the screen has two jobs: curate the managed list, and SURFACE the off-list
// strings actually in use (with their item counts) so the operator can promote
// the real units and see the typos. Splitting those two sets is the pure part.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { splitUnitUsage, type ManagedUnit } from "@/lib/catalog/units-curation";
import { UnitsBoard } from "@/components/features/catalog/units-board";

const MANAGED: ManagedUnit[] = [
  {
    code: "เส้น",
    displayName: "เส้น",
    abbrShort: null,
    unitClass: "count",
    sortOrder: 10,
    isActive: true,
  },
  {
    code: "ถุง",
    displayName: "ถุง",
    abbrShort: null,
    unitClass: "count",
    sortOrder: 20,
    isActive: true,
    addedBy: { name: "จัดซื้อ ทดสอบ", at: "2026-07-26T09:03:23.000Z" },
  },
  {
    code: "ลัง",
    displayName: "ลัง",
    abbrShort: null,
    unitClass: "count",
    sortOrder: 30,
    isActive: false,
  },
];

// What the page reads: one row per ACTIVE catalog item, carrying its unit text.
const USAGE = ["เส้น", "เส้น", "เส้น", "ถุง", "หลอด", "หลอด", "ปิีป", null];

describe("splitUnitUsage (spec 361 U8)", () => {
  it("counts usage per managed unit and keeps the managed order", () => {
    const { managed } = splitUnitUsage(MANAGED, USAGE);
    expect(managed.map((m) => [m.code, m.usage])).toEqual([
      ["เส้น", 3],
      ["ถุง", 1],
      ["ลัง", 0],
    ]);
  });

  it("surfaces off-list strings with their counts", () => {
    const { offList } = splitUnitUsage(MANAGED, USAGE);
    expect(offList).toEqual([
      { unit: "หลอด", usage: 2 },
      { unit: "ปิีป", usage: 1 },
    ]);
  });

  // Ordering needs a fixture whose FIRST-SEEN order is the WRONG order —
  // otherwise the assertion passes on insertion order alone and says nothing
  // about the sort (caught by mutation-checking: deleting the sort stayed green).
  it("puts the most-used off-list string first, whatever order it was seen in", () => {
    const seenLowUsageFirst = ["ปิีป", "หลอด", "หลอด", "หลอด"];
    const { offList } = splitUnitUsage(MANAGED, seenLowUsageFirst);
    expect(offList.map((o) => o.unit)).toEqual(["หลอด", "ปิีป"]);
  });

  it("ignores empty and null unit values — they are not a unit anyone typed", () => {
    const { offList } = splitUnitUsage(MANAGED, [null, "", "   ", "หลอด"]);
    expect(offList).toEqual([{ unit: "หลอด", usage: 1 }]);
  });

  it("counts an INACTIVE managed unit as managed, never as off-list", () => {
    // Retiring a unit must not make every item still carrying it look unmanaged.
    const { managed, offList } = splitUnitUsage(MANAGED, ["ลัง", "ลัง"]);
    expect(managed.find((m) => m.code === "ลัง")?.usage).toBe(2);
    expect(offList).toEqual([]);
  });
});

// Spec 361 U8 follow-up (operator 2026-07-26: "highlight it for manager to
// verify"). A unit added THROUGH THE APP is a curation decision someone made —
// including the one CC made while proving the write path. The seeded spec-223
// vocabulary carries no created_by, so provenance separates them exactly, and
// the manager can see what was added, by whom, and retire it in one tap.
describe("UnitsBoard — provenance highlight", () => {
  it("flags an app-added unit with who added it, and leaves seeded units unmarked", () => {
    const { managed } = splitUnitUsage(MANAGED, USAGE);
    render(<UnitsBoard managed={managed} offList={[]} />);
    const added = screen.getByTestId("unit-row-ถุง");
    expect(within(added).getByText(/เพิ่มในแอป/)).toBeInTheDocument();
    expect(within(added).getByText(/จัดซื้อ ทดสอบ/)).toBeInTheDocument();
    expect(within(screen.getByTestId("unit-row-เส้น")).queryByText(/เพิ่มในแอป/)).toBeNull();
  });

  it("counts the app-added units in the section header so they are findable", () => {
    const { managed } = splitUnitUsage(MANAGED, USAGE);
    render(<UnitsBoard managed={managed} offList={[]} />);
    expect(screen.getByText(/เพิ่มในแอป 1 รายการ/)).toBeInTheDocument();
  });

  it("says nothing about provenance when every unit came from the seed", () => {
    const seededOnly = MANAGED.map((m) => ({ ...m, addedBy: null }));
    render(<UnitsBoard managed={splitUnitUsage(seededOnly, USAGE).managed} offList={[]} />);
    expect(screen.queryByText(/เพิ่มในแอป/)).toBeNull();
  });
});

describe("UnitsBoard", () => {
  it("lists managed units with usage, and marks the retired ones", () => {
    render(<UnitsBoard managed={splitUnitUsage(MANAGED, USAGE).managed} offList={[]} />);
    const row = screen.getByTestId("unit-row-เส้น");
    expect(within(row).getByText(/ในทะเบียนวัสดุ 3 รายการ/)).toBeInTheDocument();
    expect(within(screen.getByTestId("unit-row-ลัง")).getByText(/ปิดใช้งาน/)).toBeInTheDocument();
    expect(within(row).queryByText(/ปิดใช้งาน/)).toBeNull();
  });

  it("shows each off-list string with its item count and an add control", () => {
    const { managed, offList } = splitUnitUsage(MANAGED, USAGE);
    render(<UnitsBoard managed={managed} offList={offList} />);
    const row = screen.getByTestId("offlist-row-หลอด");
    expect(within(row).getByText(/2 รายการ/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /เพิ่มเป็นหน่วยนับ/ })).toBeInTheDocument();
  });

  it("says so plainly when every unit in the catalog is already managed", () => {
    // Both halves come from the SAME split — hardcoding offList={[]} would prove
    // nothing about the function that produces it.
    const { managed, offList } = splitUnitUsage(MANAGED, ["เส้น"]);
    render(<UnitsBoard managed={managed} offList={offList} />);
    expect(screen.getByText(/ทุกหน่วยในทะเบียนวัสดุอยู่ในรายการแล้ว/)).toBeInTheDocument();
    expect(screen.queryByTestId(/^offlist-row-/)).toBeNull();
  });
});

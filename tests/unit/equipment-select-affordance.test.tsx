// Writing failing test first.
//
// Operator, 2026-07-30, on the /equipment sheets: "We want PRI to be a selection,
// currently it is text."
//
// It IS a <select> — and it was already prefilled with PRI. The defect is purely
// that it does not LOOK like one: every select in this component stacked
// `appearance-none` on top of FIELD_STACKED (an INPUT class), which strips the
// native dropdown chevron and leaves nothing in its place. A picker rendered
// pixel-identical to a text box reads as a text box, so the operator reasonably
// concluded the value was typed rather than chosen — and a field nobody realises
// is tappable is a field nobody taps.
//
// `appearance-none` is legitimate on a date INPUT (it tames iOS's native date
// chrome — /accounting and /requests use it that way). On a SELECT it deletes the
// only affordance the control has.
//
// jsdom cannot see a native chevron, so the pin is the absence of the class that
// suppresses it. Narrow, but it fails for exactly the reason the operator
// reported, and it is mutation-checkable.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/equipment/actions", () => ({
  createEquipment: vi.fn().mockResolvedValue({ ok: true }),
  updateEquipment: vi.fn().mockResolvedValue({ ok: true }),
  createEquipmentCategory: vi.fn().mockResolvedValue({ ok: true }),
  createEquipmentOwner: vi.fn().mockResolvedValue({ ok: true }),
  recordEquipmentMovement: vi.fn().mockResolvedValue({ ok: true }),
  setEquipmentDailyRate: vi.fn().mockResolvedValue({ ok: true }),
  setEquipmentItemImage: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  EquipmentManager,
  type ManagedEquipmentItem,
} from "@/components/features/equipment/equipment-manager";

const CATEGORIES = [{ id: "c1", name: "เครื่องปั่นไฟ" }];
const OWNERS = [
  { id: "o1", name: "Preston Construction Co., Ltd." },
  { id: "o2", name: "Preston International Co., Ltd.", isDefault: true },
];
const PROJECTS = [{ id: "p1", name: "ไซต์บางนา" }];
const ITEMS: ManagedEquipmentItem[] = [
  {
    id: "e1",
    name: "เครื่องปั่นไฟ 5kVA",
    category_id: "c1",
    owner_id: "o1",
    tracking: "unit",
    asset_tag: "GEN-001",
    quantity: null,
    status: "available",
  },
];

function renderManager(items: ManagedEquipmentItem[] = []) {
  render(
    <EquipmentManager
      items={items}
      categories={CATEGORIES}
      owners={OWNERS}
      projects={PROJECTS}
      movements={[]}
      canManageRegistry
    />,
  );
}

function openSheet(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Every <select> currently in the document reads as a picker, not a text box. */
function expectPickersLookLikePickers() {
  const selects = screen.getAllByRole("combobox");
  expect(selects.length).toBeGreaterThan(0);
  for (const el of selects) {
    expect(el.className).not.toContain("appearance-none");
  }
}

beforeEach(() => {
  mockRefresh.mockReset();
});

describe("equipment sheets — a picker must look like a picker", () => {
  it("the add sheet's หมวดหมู่ / เจ้าของ / สถานะ keep their dropdown affordance", () => {
    renderManager();
    openSheet("เพิ่มอุปกรณ์");
    // The three fields the operator meets when filling the registry by hand.
    expect(screen.getByLabelText("หมวดหมู่")).toBeInTheDocument();
    expect(screen.getByLabelText("เจ้าของ")).toBeInTheDocument();
    expect(screen.getByLabelText("สถานะ")).toBeInTheDocument();
    expectPickersLookLikePickers();
  });

  it("the edit sheet's pickers keep it too — same fields, same complaint", () => {
    renderManager(ITEMS);
    openSheet("แก้ไข");
    expectPickersLookLikePickers();
  });

  it("the move sheet's ประเภทการเคลื่อนย้าย / โครงการ keep it as well", () => {
    renderManager(ITEMS);
    openSheet("ย้าย");
    // โครงการ only renders for the 'deployed' kind, which is the default.
    expect(screen.getByLabelText("ประเภทการเคลื่อนย้าย")).toBeInTheDocument();
    expectPickersLookLikePickers();
  });

  // The operator's own words were about the VALUE looking typed. Pin that the
  // owner field really is a chooser holding the flagged default, so a future
  // change to either half fails here rather than in the field.
  it("เจ้าของ is a real combobox already holding the default owner", () => {
    renderManager();
    openSheet("เพิ่มอุปกรณ์");
    const owner = screen.getByLabelText<HTMLSelectElement>("เจ้าของ");
    expect(owner.tagName).toBe("SELECT");
    expect(owner.value).toBe("o2");
    expect(Array.from(owner.options).map((o) => o.text)).toContain(
      "Preston International Co., Ltd.",
    );
  });
});

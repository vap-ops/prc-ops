// Spec 361 U8 — the add/edit sheet and the actions behind it.
//
// Both had ZERO coverage in the first cut; fresh-eyes review named the exact
// mutations that would have stayed green, and one of them was a live defect:
// `update_catalog_unit` assigns `abbr_short = v_abbr` unconditionally, so an
// action that omits `p_abbr_short` wipes the stored abbreviation on every edit.
// These tests pin the RPC argument names, the code-immutability invariant, and
// the error mapping.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createCatalogUnit: vi.fn(async () => ({ ok: true as const })),
  updateCatalogUnit: vi.fn(async () => ({ ok: true as const })),
  setCatalogUnitActive: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("@/app/catalog/units/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { UnitSheet } from "@/components/features/catalog/unit-sheet";
import type { ManagedUnitUsage } from "@/lib/catalog/units-curation";

const UNIT: ManagedUnitUsage = {
  code: "เส้น",
  displayName: "เส้น",
  abbrShort: "ส.",
  unitClass: "length",
  sortOrder: 10,
  isActive: true,
  usage: 4,
};

beforeEach(() => {
  actions.createCatalogUnit.mockClear();
  actions.updateCatalogUnit.mockClear();
  actions.setCatalogUnitActive.mockClear();
});

describe("UnitSheet — edit mode", () => {
  it("locks the code: catalog_items.unit stores it as text, so a recode orphans items", () => {
    render(<UnitSheet mode="edit" unit={UNIT} onClose={() => {}} />);
    // Code and display name both read "เส้น" — the FIRST field is the code.
    const [codeField, nameField] = screen.getAllByDisplayValue("เส้น");
    expect(codeField).toBeDisabled();
    expect(nameField).not.toBeDisabled();
  });

  it("sends the abbreviation back on save — omitting it makes the RPC wipe it", async () => {
    render(<UnitSheet mode="edit" unit={UNIT} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(actions.updateCatalogUnit).toHaveBeenCalledTimes(1));
    expect(actions.updateCatalogUnit).toHaveBeenCalledWith({
      code: "เส้น",
      displayName: "เส้น",
      abbrShort: "ส.",
      unitClass: "length",
      sortOrder: 10,
    });
    expect(actions.createCatalogUnit).not.toHaveBeenCalled();
  });

  it("shows how many items carry the unit, and asks twice before retiring a used one", async () => {
    render(<UnitSheet mode="edit" unit={UNIT} onClose={() => {}} />);
    expect(screen.getByText(/มีวัสดุใช้หน่วยนี้อยู่ 4 รายการ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
    expect(actions.setCatalogUnitActive).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/กดอีกครั้งเพื่อยืนยัน/);

    fireEvent.click(screen.getByRole("button", { name: "ยืนยันปิดใช้งาน" }));
    await waitFor(() => expect(actions.setCatalogUnitActive).toHaveBeenCalledTimes(1));
    expect(actions.setCatalogUnitActive).toHaveBeenCalledWith({ code: "เส้น", isActive: false });
  });

  it("retires an UNUSED unit on the first press — no ceremony where nothing is at stake", async () => {
    render(<UnitSheet mode="edit" unit={{ ...UNIT, usage: 0 }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
    await waitFor(() => expect(actions.setCatalogUnitActive).toHaveBeenCalledTimes(1));
  });

  it("surfaces the action's error verbatim instead of closing", async () => {
    actions.updateCatalogUnit.mockResolvedValueOnce({
      ok: false,
      error: "ไม่มีสิทธิ์แก้ไขหน่วยนับ",
    } as never);
    const onClose = vi.fn();
    render(<UnitSheet mode="edit" unit={UNIT} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.getByText("ไม่มีสิทธิ์แก้ไขหน่วยนับ")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("UnitSheet — create / promote mode", () => {
  it("pre-fills an off-list string as both code and name, and creates (never updates)", async () => {
    render(<UnitSheet mode="create" initialCode="หลอด" onClose={() => {}} />);
    const code = screen.getAllByDisplayValue("หลอด")[0]!;
    expect(code).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(actions.createCatalogUnit).toHaveBeenCalledTimes(1));
    expect(actions.createCatalogUnit).toHaveBeenCalledWith({
      code: "หลอด",
      displayName: "หลอด",
      abbrShort: null,
      unitClass: "count",
      sortOrder: 0,
    });
    expect(actions.updateCatalogUnit).not.toHaveBeenCalled();
  });

  it("offers no retire control — there is nothing to retire yet", () => {
    render(<UnitSheet mode="create" initialCode="" onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /ปิดใช้งาน/ })).toBeNull();
  });
});

// Spec 245 U4 — the shared draft-row sub-component extracted from the
// SupplyPlanManager grid (item picker + qty + note + remove-row), reused by the
// full grid AND the stripped-down template editor. The WP column is NOT part of
// the shared row — the manager passes its WP select/multi-WP panel in via
// wpSlot; the template editor passes nothing (templates have no WPs, D5).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SupplyPlanDraftRow, type DraftRow } from "@/components/features/supply-plan/draft-row";

const catalogItems = [
  {
    id: "ci1",
    categoryId: "cat-elec",
    categoryName: "งานไฟฟ้า",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    thumbnailUrl: null,
  },
];
const categories = [{ id: "cat-elec", name: "งานไฟฟ้า" }];

const row: DraftRow = { key: 1, catalogItemId: "", workPackageId: "", qty: "", note: "" };

function renderRow(opts?: {
  row?: DraftRow;
  disabled?: boolean;
  onPatch?: (patch: Partial<DraftRow>) => void;
  onDrop?: () => void;
  wpSlot?: React.ReactNode;
}) {
  render(
    <SupplyPlanDraftRow
      row={opts?.row ?? row}
      catalogItems={catalogItems}
      categories={categories}
      disabled={opts?.disabled ?? false}
      onPatch={opts?.onPatch ?? (() => {})}
      onDrop={opts?.onDrop ?? (() => {})}
      wpSlot={opts?.wpSlot}
    />,
  );
}

describe("SupplyPlanDraftRow (spec 245 U4)", () => {
  it("renders the item picker, qty, note, and remove-row controls", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" })).toBeInTheDocument();
    expect(screen.getByLabelText("จำนวน")).toBeInTheDocument();
    expect(screen.getByLabelText("หมายเหตุ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เอาแถวออก" })).toBeInTheDocument();
  });

  it("patches the row on item pick, qty and note input; drops it on remove", () => {
    const onPatch = vi.fn();
    const onDrop = vi.fn();
    renderRow({ onPatch, onDrop });

    fireEvent.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
    fireEvent.click(screen.getByRole("button", { name: /สายไฟ NYY/ }));
    expect(onPatch).toHaveBeenCalledWith({ catalogItemId: "ci1" });

    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "7" } });
    expect(onPatch).toHaveBeenCalledWith({ qty: "7" });

    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "ด่วน" } });
    expect(onPatch).toHaveBeenCalledWith({ note: "ด่วน" });

    fireEvent.click(screen.getByRole("button", { name: "เอาแถวออก" }));
    expect(onDrop).toHaveBeenCalled();
  });

  it("disables the inputs and remove button while saving", () => {
    renderRow({ disabled: true });
    expect(screen.getByLabelText("จำนวน")).toBeDisabled();
    expect(screen.getByLabelText("หมายเหตุ")).toBeDisabled();
    expect(screen.getByRole("button", { name: "เอาแถวออก" })).toBeDisabled();
  });

  it("renders the wpSlot when the caller provides one (the manager's WP column)", () => {
    renderRow({ wpSlot: <div data-testid="wp-slot">งาน</div> });
    expect(screen.getByTestId("wp-slot")).toBeInTheDocument();
  });

  it("renders no WP affordance at all without a wpSlot (the template editor)", () => {
    renderRow();
    expect(screen.queryByLabelText("งาน")).toBeNull();
    expect(screen.queryByRole("button", { name: /หลายงาน/ })).toBeNull();
  });
});

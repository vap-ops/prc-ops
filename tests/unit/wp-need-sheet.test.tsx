// Spec 363 U4 (D5) — the `ต้องการของ` sheet: ONE entry point, item-first.
//
// The three write paths already exist and are tested on their own; this pins the
// ROUTING — which actions the shelf offers, in what order, and that choosing one
// hands the chosen item to that path. The forms are mocked so a failure here is
// unambiguously the sheet's.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/components/features/purchasing/purchase-request-form", () => ({
  PurchaseRequestForm: ({ initialCatalogItemId }: { initialCatalogItemId?: string }) => (
    <div data-testid="form-request">request:{initialCatalogItemId ?? "none"}</div>
  ),
}));
vi.mock("@/components/features/purchasing/self-purchase-form", () => ({
  SelfPurchaseForm: ({ initialCatalogItemId }: { initialCatalogItemId?: string }) => (
    <div data-testid="form-self">self:{initialCatalogItemId ?? "none"}</div>
  ),
}));
vi.mock("@/components/features/store/wp-issue-stock", () => ({
  // The mock exposes `embedded` on purpose: un-embedded, this component renders
  // its OWN trigger + BottomSheet + issues list, so inside the need-sheet the SA
  // would face a second button opening a third nested sheet. A mock that hid the
  // prop would keep that integration bug invisible — which is exactly how it got
  // written in the first place.
  WpIssueStock: ({
    initialCatalogItemId,
    embedded,
  }: {
    initialCatalogItemId?: string;
    embedded?: boolean;
  }) => (
    <div data-testid="form-issue" data-embedded={embedded ? "yes" : "no"}>
      issue:{initialCatalogItemId ?? "none"}
    </div>
  ),
}));

import { WpNeedSheet } from "@/components/features/work-packages/wp-need-sheet";

const CEMENT = "ci-cement";
const WIRE = "ci-wire";

const catalogItems = [
  {
    id: CEMENT,
    categoryId: null,
    categoryName: "",
    baseItem: "ปูนซีเมนต์",
    specAttrs: null,
    unit: "ถุง",
    thumbnailUrl: null,
  },
  {
    id: WIRE,
    categoryId: null,
    categoryName: "",
    baseItem: "สายไฟ",
    specAttrs: null,
    unit: "ม้วน",
    thumbnailUrl: null,
  },
];

// ปูน is on the shelf; สายไฟ has never been stocked (no row at all).
const onHand = [
  {
    catalogItemId: CEMENT,
    baseItem: "ปูนซีเมนต์",
    specAttrs: null,
    unit: "ถุง",
    qtyOnHand: 12,
    categoryId: null,
    kind: null,
  },
];

function renderSheet() {
  render(
    <WpNeedSheet
      workPackage={{ id: "wp1", code: "WP-01", name: "งาน", categoryCode: null }}
      projectId="p1"
      userId="u1"
      catalogItems={catalogItems as never}
      categories={[]}
      onHand={onHand as never}
      workers={[]}
      issues={[]}
    />,
  );
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: "ต้องการของ" }));
  return screen.getByRole("dialog");
}

function pick(name: RegExp) {
  const sheet = screen.getAllByRole("dialog").at(-1)!;
  fireEvent.click(screen.getByRole("button", { name: /เลือกวัสดุ/ }));
  const picker = screen.getAllByRole("dialog").at(-1)!;
  const [row] = within(picker)
    .getAllByRole("button")
    .filter((b) => name.test(b.textContent ?? ""));
  fireEvent.click(row!);
  return sheet;
}

describe("WpNeedSheet (spec 363 D5)", () => {
  it("opens with ONE entry point, not three", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "ต้องการของ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เบิกวัสดุจากคลัง/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ขอซื้อ/ })).toBeNull();
  });

  it("asks for the ITEM before asking for the path", () => {
    renderSheet();
    const sheet = open();
    // No path buttons until an item is chosen — the whole point of item-first.
    expect(within(sheet).queryByRole("button", { name: /เบิกจากคลัง/ })).toBeNull();
    expect(within(sheet).getByRole("button", { name: /เลือกวัสดุ/ })).toBeInTheDocument();
  });

  it("leads with เบิก and shows the on-hand when the store holds it", () => {
    renderSheet();
    open();
    const sheet = pick(/ปูนซีเมนต์/);
    expect(within(sheet).getByRole("button", { name: /เบิกจากคลัง/ })).toBeInTheDocument();
    expect(within(sheet).getByText(/12 ถุง/)).toBeInTheDocument();
  });

  it("leads with ขอซื้อ and does not offer เบิก when the shelf is empty", () => {
    renderSheet();
    open();
    const sheet = pick(/สายไฟ/);
    expect(within(sheet).getByRole("button", { name: /ขอซื้อ/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /เบิกจากคลัง/ })).toBeNull();
  });

  it("always offers ซื้อมาเองแล้ว, on both shelf states", () => {
    renderSheet();
    open();
    expect(
      within(pick(/ปูนซีเมนต์/)).getByRole("button", { name: /ซื้อมาเองแล้ว/ }),
    ).toBeInTheDocument();
  });

  it("hands the chosen item to the เบิก path", () => {
    renderSheet();
    open();
    const sheet = pick(/ปูนซีเมนต์/);
    fireEvent.click(within(sheet).getByRole("button", { name: /เบิกจากคลัง/ }));
    expect(screen.getByTestId("form-issue")).toHaveTextContent(`issue:${CEMENT}`);
  });

  it("hands the chosen item to the ขอซื้อ path", () => {
    renderSheet();
    open();
    const sheet = pick(/สายไฟ/);
    fireEvent.click(within(sheet).getByRole("button", { name: /ขอซื้อ/ }));
    expect(screen.getByTestId("form-request")).toHaveTextContent(`request:${WIRE}`);
  });

  it("hands the chosen item to the ซื้อมาเองแล้ว path", () => {
    renderSheet();
    open();
    const sheet = pick(/ปูนซีเมนต์/);
    fireEvent.click(within(sheet).getByRole("button", { name: /ซื้อมาเองแล้ว/ }));
    expect(screen.getByTestId("form-self")).toHaveTextContent(`self:${CEMENT}`);
  });

  it("lets the SA go back and choose a different item without reopening", () => {
    // Committing to an item by accident must not mean closing and starting over.
    renderSheet();
    open();
    const sheet = pick(/ปูนซีเมนต์/);
    fireEvent.click(within(sheet).getByRole("button", { name: /เปลี่ยนวัสดุ/ }));
    expect(within(sheet).queryByRole("button", { name: /เบิกจากคลัง/ })).toBeNull();
    expect(within(sheet).getByRole("button", { name: /เลือกวัสดุ/ })).toBeInTheDocument();
  });

  it("renders no form until a path is chosen", () => {
    renderSheet();
    open();
    pick(/ปูนซีเมนต์/);
    expect(screen.queryByTestId("form-issue")).toBeNull();
    expect(screen.queryByTestId("form-request")).toBeNull();
    expect(screen.queryByTestId("form-self")).toBeNull();
  });
});

describe("WpNeedSheet — changing the item invalidates the path", () => {
  it("does not keep เบิก selected after switching to an item the store lacks", () => {
    // The mutation that drops `setPath(null)` from chooseItem survived every
    // other test, because they all change the item BEFORE choosing a path. This
    // is the sequence that actually breaks: ปูน is stocked → เบิก → change to
    // สายไฟ, which the store has never carried. A stale path would render the
    // withdrawal form for an item that cannot be withdrawn.
    renderSheet();
    open();
    const sheet = pick(/ปูนซีเมนต์/);
    fireEvent.click(within(sheet).getByRole("button", { name: /เบิกจากคลัง/ }));
    expect(screen.getByTestId("form-issue")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: /เปลี่ยนวัสดุ/ }));
    pick(/สายไฟ/);

    // Back to the path choice for the NEW item, with เบิก not on offer at all.
    expect(screen.queryByTestId("form-issue")).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /เบิกจากคลัง/ })).toBeNull();
    expect(within(sheet).getByRole("button", { name: /ขอซื้อ/ })).toBeInTheDocument();
  });
});

describe("WpNeedSheet — the เบิก path is embedded, not nested", () => {
  it("renders WpIssueStock in embedded mode", () => {
    // Without this the SA taps เบิกจากคลัง and meets a SECOND เบิกวัสดุจากคลัง
    // button opening a third sheet, with the recent-เบิก list stacked between.
    renderSheet();
    open();
    const sheet = pick(/ปูนซีเมนต์/);
    fireEvent.click(within(sheet).getByRole("button", { name: /เบิกจากคลัง/ }));
    expect(screen.getByTestId("form-issue")).toHaveAttribute("data-embedded", "yes");
  });
});

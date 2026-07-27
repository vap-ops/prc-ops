// Spec 363 U4 — four fixes from the fresh-eyes pass on the ต้องการของ sheet.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/requests/actions", () => ({ createPurchaseRequest: vi.fn() }));
vi.mock("@/app/expenses/actions", () => ({ recordSelfPurchase: vi.fn() }));
vi.mock("@/app/store/actions", () => ({
  issueStockBulk: vi.fn(),
  reverseStockIssue: vi.fn(),
  returnStockToStore: vi.fn(),
  confirmStockIssueOnBehalf: vi.fn(),
}));

import { PurchaseRequestForm } from "@/components/features/purchasing/purchase-request-form";
import { WpNeedSheet } from "@/components/features/work-packages/wp-need-sheet";

const items = [
  {
    id: "ci-rebar6",
    categoryId: null,
    categoryName: "",
    baseItem: "เหล็กเส้น",
    specAttrs: "6mm",
    unit: "เส้น",
    thumbnailUrl: null,
  },
  {
    id: "ci-rebar9",
    categoryId: null,
    categoryName: "",
    baseItem: "เหล็กเส้น",
    specAttrs: "9mm",
    unit: "เส้น",
    thumbnailUrl: null,
  },
];

const onHand = [
  {
    catalogItemId: "ci-rebar9",
    baseItem: "เหล็กเส้น",
    specAttrs: "9mm",
    unit: "เส้น",
    qtyOnHand: 4,
    categoryId: null,
    kind: null,
  },
];

describe("PurchaseRequestForm — a seeded item is not 'typed' (spec 363 U4)", () => {
  it("opens quiet when the sheet hands it an item", () => {
    // The form's own comment promises an untouched form stays quiet. Seeding the
    // item made userTyped true on mount, so the ขอซื้อ path opened inside the
    // sheet already showing a red validation error.
    render(
      <PurchaseRequestForm
        workPackage={{ id: "wp1", code: "WP-01", name: "งาน", categoryCode: null }}
        projectId="p1"
        userId="u1"
        catalogItems={items as never}
        categories={[]}
        initialCatalogItemId="ci-rebar6"
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still validates once the SA actually types", () => {
    render(
      <PurchaseRequestForm
        workPackage={{ id: "wp1", code: "WP-01", name: "งาน", categoryCode: null }}
        projectId="p1"
        userId="u1"
        catalogItems={items as never}
        categories={[]}
        initialCatalogItemId="ci-rebar6"
      />,
    );
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "0" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("WpNeedSheet — the confirm card names the exact item (spec 363 U4)", () => {
  function renderSheet() {
    render(
      <WpNeedSheet
        workPackage={{ id: "wp1", code: "WP-01", name: "งาน", categoryCode: null }}
        projectId="p1"
        userId="u1"
        catalogItems={items as never}
        categories={[]}
        onHand={onHand as never}
        workers={[]}
        issues={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ต้องการของ" }));
  }

  it("keeps specAttrs, so two sizes of the same bar are distinguishable", () => {
    // Dropping specAttrs makes "เหล็กเส้น 6mm" and "เหล็กเส้น 9mm" both read
    // "เหล็กเส้น" — on the card whose whole job is "this is what you picked".
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /เลือกวัสดุ/ }));
    const picker = screen.getAllByRole("dialog").at(-1)!;
    const [row] = within(picker)
      .getAllByRole("button")
      .filter((b) => /6mm/.test(b.textContent ?? ""));
    fireEvent.click(row!);
    const sheet = screen.getAllByRole("dialog")[0]!;
    expect(within(sheet).getByText(/เหล็กเส้น 6mm/)).toBeInTheDocument();
  });
});

// Spec 211 U11a→U11c-B — self-purchase consolidation, now ONE guided ซื้อเอง form
// (U11c unified U11a's two cards). Load-bearing: the ซื้อเอง heading frames it, and
// the unified form's item-source toggle is present (catalog OR free-text).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/requests/actions", () => ({
  recordSitePurchase: vi.fn(async () => ({ ok: true as const, id: "rec-1" })),
}));
vi.mock("@/app/store/actions", () => ({
  sitePurchaseUseNow: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/components/features/purchasing/invoice-uploader", () => ({
  InvoiceUploader: () => <div data-testid="invoice-uploader" />,
}));
vi.mock("@/components/features/purchasing/item-photo-uploader", () => ({
  ItemPhotoUploader: () => <div data-testid="item-photo-uploader" />,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SelfPurchaseSection } from "@/components/features/purchasing/self-purchase-section";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";

const WP_ID = "00000000-0000-0000-0000-000000000001";
const PROJECT_ID = "00000000-0000-0000-0000-000000000002";
const catalogItems: PurchaseRequestCatalogItem[] = [
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

function renderSection() {
  render(
    <SelfPurchaseSection
      projectId={PROJECT_ID}
      workPackageId={WP_ID}
      catalogItems={catalogItems}
      categories={categories}
    />,
  );
}

describe("SelfPurchaseSection (spec 285 U3 — the site-expense surface)", () => {
  it("frames the form as an EXPENSE, not ซื้อเอง — expense heading, no legacy copy", () => {
    renderSection();
    expect(screen.getByText("บันทึกค่าใช้จ่าย (จ่ายเงินไปแล้ว)")).toBeInTheDocument();
    // The old ซื้อเอง framing + the dropped free-text/use-now copy are gone.
    expect(screen.queryByText("ซื้อเอง")).toBeNull();
    expect(screen.queryByText(/พิมพ์เอง/)).toBeNull();
    expect(screen.queryByText(/ใช้ที่งานนี้เลย/)).toBeNull();
  });

  it("carries a Receipt icon to distinguish the expense from a ขอซื้อ request", () => {
    const { container } = render(
      <SelfPurchaseSection
        projectId={PROJECT_ID}
        workPackageId={WP_ID}
        catalogItems={catalogItems}
        categories={categories}
      />,
    );
    expect(container.querySelector("svg.lucide-receipt")).not.toBeNull();
  });

  it("is catalog-only — offers the material picker, no free-text toggle (spec 285 U1)", () => {
    renderSection();
    expect(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" })).toBeInTheDocument();
    expect(screen.queryByText("พิมพ์เอง")).toBeNull();
  });

  it("offers the expense submit verb by default (no catalog item picked yet)", () => {
    renderSection();
    expect(screen.getByRole("button", { name: "บันทึกค่าใช้จ่าย" })).toBeInTheDocument();
  });
});

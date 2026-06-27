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

import {
  SelfPurchaseSection,
  type CatalogPick,
} from "@/components/features/purchasing/self-purchase-section";

const WP_ID = "00000000-0000-0000-0000-000000000001";
const PROJECT_ID = "00000000-0000-0000-0000-000000000002";
const catalogItems: CatalogPick[] = [
  { id: "ci1", category: "electrical", baseItem: "สายไฟ NYY", specAttrs: "3x6", unit: "ม้วน" },
];

function renderSection() {
  render(
    <SelfPurchaseSection
      projectId={PROJECT_ID}
      workPackageId={WP_ID}
      catalogItems={catalogItems}
    />,
  );
}

describe("SelfPurchaseSection (spec 211 U11c-B)", () => {
  it("frames the unified self-purchase form under one ซื้อเอง heading", () => {
    renderSection();
    expect(screen.getByText("ซื้อเอง")).toBeInTheDocument();
  });

  it("renders the unified form's item-source toggle (catalog OR free-text)", () => {
    renderSection();
    expect(screen.getByRole("button", { name: "เลือกจากคลัง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "พิมพ์เอง" })).toBeInTheDocument();
  });

  it("offers the record submit by default (no catalog item picked yet)", () => {
    renderSection();
    expect(screen.getByRole("button", { name: "บันทึกการซื้อ" })).toBeInTheDocument();
  });
});

// Spec 211 U11a — self-purchase consolidation. The operator's steer: "PR is PR,
// self purchase is self purchase … consolidate in 1 place." The two self-purchase
// actions previously sat in different WP tabs (บันทึกการซื้อหน้างาน in คำขอซื้อ,
// ซื้อเงินสด ใช้ที่งานนี้เลย in เบิกของ). This section groups BOTH under one ซื้อเอง
// heading. Load-bearing: both self-purchase affordances are present in one place;
// the ask-procurement PR form is NOT part of this section (kept separate).

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

describe("SelfPurchaseSection (spec 211 U11a)", () => {
  it("groups both self-purchase actions under one ซื้อเอง heading", () => {
    renderSection();
    expect(screen.getByText("ซื้อเอง")).toBeInTheDocument();
  });

  it("offers the off-catalog record path (#2 บันทึกการซื้อหน้างาน)", () => {
    renderSection();
    expect(screen.getByText("บันทึกการซื้อหน้างาน")).toBeInTheDocument();
  });

  it("offers the catalogued cash use-now path (#3 ใช้ที่งานนี้เลย)", () => {
    renderSection();
    expect(screen.getByRole("button", { name: /ใช้ที่งานนี้เลย/ })).toBeInTheDocument();
  });
});

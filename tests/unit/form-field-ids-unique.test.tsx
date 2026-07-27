// Spec 363 U4 — the ต้องการของ sheet renders PurchaseRequestForm and
// SelfPurchaseForm as a SECOND instance while the คำขอซื้อ / ค่าใช้จ่ายหน้างาน
// tabs still hold the first. wp-detail-tabs keeps every panel MOUNTED (hidden,
// not unmounted — see its header comment), and <details> content is mounted too.
//
// Hardcoded field ids therefore exist twice in one document, and `htmlFor`
// resolves to the FIRST match in document order — the hidden copy in another
// tab. Tapping "จำนวน" in the sheet would focus an invisible input.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/requests/actions", () => ({ createPurchaseRequest: vi.fn() }));
vi.mock("@/app/expenses/actions", () => ({ recordSelfPurchase: vi.fn() }));

import { PurchaseRequestForm } from "@/components/features/purchasing/purchase-request-form";
import { SelfPurchaseForm } from "@/components/features/purchasing/self-purchase-form";

const catalogItems = [
  {
    id: "ci1",
    categoryId: null,
    categoryName: "",
    baseItem: "ปูน",
    specAttrs: null,
    unit: "ถุง",
    thumbnailUrl: null,
  },
];

function duplicateIds(root: HTMLElement): string[] {
  const seen = new Map<string, number>();
  for (const el of root.querySelectorAll("[id]")) {
    const id = el.id;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

describe("form field ids survive being mounted twice (spec 363 U4)", () => {
  it("PurchaseRequestForm mints unique ids per instance", () => {
    const { container } = render(
      <>
        <PurchaseRequestForm
          workPackage={{ id: "wp1", code: "WP-01", name: "งาน", categoryCode: null }}
          projectId="p1"
          userId="u1"
          catalogItems={catalogItems as never}
          categories={[]}
        />
        <PurchaseRequestForm
          workPackage={{ id: "wp1", code: "WP-01", name: "งาน", categoryCode: null }}
          projectId="p1"
          userId="u1"
          catalogItems={catalogItems as never}
          categories={[]}
        />
      </>,
    );
    expect(duplicateIds(container)).toEqual([]);
  });

  it("SelfPurchaseForm mints unique ids per instance", () => {
    const { container } = render(
      <>
        <SelfPurchaseForm
          projectId="p1"
          workPackageId="wp1"
          catalogItems={catalogItems as never}
          categories={[]}
        />
        <SelfPurchaseForm
          projectId="p1"
          workPackageId="wp1"
          catalogItems={catalogItems as never}
          categories={[]}
        />
      </>,
    );
    expect(duplicateIds(container)).toEqual([]);
  });
});

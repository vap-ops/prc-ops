// Spec 120 — the single-ticket "สร้างใบสั่งซื้อ" button. It CREATES a PO document,
// so it wears a document glyph (FilePlus), not the ShoppingCart that already means
// the 'purchased' status — freeing the cart from double duty.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));
vi.mock("@/app/requests/actions", () => ({
  createPurchaseOrder: vi.fn(),
  createSupplier: vi.fn(),
}));

import { CreatePoFromRequestButton } from "@/components/features/purchasing/create-po-from-request-button";
import type { CreatePoLine } from "@/components/features/purchasing/create-purchase-order-sheet";

const LINE: CreatePoLine = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  pr_number: 42,
  item_description: "ปูน",
  quantity: 5,
  unit: "ถุง",
  wp_code: "WP52",
};

describe("CreatePoFromRequestButton", () => {
  it("labels the create-PO action with a document glyph, not a ShoppingCart", () => {
    const { container } = render(<CreatePoFromRequestButton line={LINE} suppliers={[]} />);
    expect(container.querySelector(".lucide-file-plus")).toBeInTheDocument();
    expect(container.querySelector(".lucide-shopping-cart")).not.toBeInTheDocument();
  });
});

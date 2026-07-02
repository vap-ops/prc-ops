// Writing failing test first.
//
// Feedback a4e37ccd — "คำว่ารับของ ไม่ชัดเจนว่าเป็นรับจากร้าน หรือรับที่ไซท์".
// Operator decision (2026-07-02): once goods reach the site they ALWAYS land in
// the project store (คลัง) — store-first doctrine, ADR 0065 / spec 208; the
// `purchase_requests_stock_in_on_receive` trigger stocks a store-bound PR into
// คลัง on receive. So the receive ACTION is named as stock-into-store:
// RECEIVE_TO_STORE_LABEL = "รับเข้าคลัง", single-sourced in labels.ts
// (ui-term-consistency SSOT) and used by the PO receive section (header +
// submit button) and the PO stepper's received stage. Date/needed-by labels
// ("ต้องการรับของภายใน", ETA) intentionally keep "รับของ" — they describe a
// date, not the action, and were not the reported confusion.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/requests/actions", () => ({
  receivePoLines: vi.fn(),
  splitPurchaseRequestOnReceipt: vi.fn(),
}));

import { RECEIVE_TO_STORE_LABEL } from "@/lib/i18n/labels";
import { PurchaseOrderTracker } from "@/components/features/purchasing/purchase-order-tracker";
import { PoReceiveSection } from "@/components/features/purchasing/po-receive-section";

describe("receive-action wording (feedback a4e37ccd)", () => {
  it("single-sources the store-receive term", () => {
    expect(RECEIVE_TO_STORE_LABEL).toBe("รับเข้าคลัง");
  });

  it("the PO stepper's received stage says goods land in the store", () => {
    const { container } = render(<PurchaseOrderTracker status="received" />);
    const received = container.querySelector('[data-stage="received"]')!;
    expect(received.textContent).toContain(RECEIVE_TO_STORE_LABEL);
    expect(received.textContent).not.toContain("รับของ");
  });

  it("the PO receive checklist header + submit button use the store-receive term", () => {
    render(
      <PoReceiveSection
        lines={[
          {
            id: "pr1",
            pr_number: 12,
            item_description: "ปูนซีเมนต์",
            quantity: 5,
            unit: "ถุง",
            amount: null,
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: RECEIVE_TO_STORE_LABEL })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${RECEIVE_TO_STORE_LABEL}ที่เลือก (1)` }),
    ).toBeInTheDocument();
  });
});

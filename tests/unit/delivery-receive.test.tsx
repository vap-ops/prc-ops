// Writing failing test first.
//
// Spec 308 U1 — the delivery receive surface. ของเข้า owns receiving: a
// dedicated /projects/[id]/incoming/[deliveryId] page (จัดซื้อ = orders,
// ของเข้า = deliveries — operator IA directive). planDeliveryReceive is the
// pure seam: which lines are still receivable, and whether the required
// truck-photo gate is open. The checklist reuses PoReceiveSection, which
// gains a submitBlocked prop; ProofOfDeliveryUploader gains capture/label
// so the truck photo is taken live (spec 303 doctrine).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/requests/actions", () => ({
  receivePoLines: vi.fn(),
  splitPurchaseRequestOnReceipt: vi.fn(),
  addProofOfDeliveryAttachment: vi.fn(),
}));

import { planDeliveryReceive } from "@/lib/purchasing/delivery-receive";
import { PoReceiveSection } from "@/components/features/purchasing/po-receive-section";
import { ProofOfDeliveryUploader } from "@/components/features/purchasing/proof-of-delivery-uploader";
import { DeliveryProofBlock } from "@/components/features/purchasing/delivery-proof-block";
import { TRUCK_PHOTO_REQUIRED_HINT, DELIVERY_RECEIVE_PAGE_TITLE } from "@/lib/i18n/labels";

const line = (id: string, status: string) =>
  ({
    id,
    pr_number: 1,
    item_description: "ปูน",
    quantity: 5,
    unit: "ถุง",
    status,
  }) as never;

describe("planDeliveryReceive (spec 308)", () => {
  it("splits receivable (purchased/on_route) from already-received lines", () => {
    const plan = planDeliveryReceive({
      lines: [line("a", "purchased"), line("b", "on_route"), line("c", "delivered")],
      proofPhotoCount: 1,
    });
    expect(plan.receivable.map((l: { id: string }) => l.id)).toEqual(["a", "b"]);
    expect(plan.receivedCount).toBe(1);
    expect(plan.allReceived).toBe(false);
  });

  it("allReceived when nothing is left in transit AND something landed", () => {
    const plan = planDeliveryReceive({ lines: [line("c", "delivered")], proofPhotoCount: 2 });
    expect(plan.allReceived).toBe(true);
    expect(plan.receivable).toEqual([]);
  });

  it("an all-cancelled delivery is NOT 'received' (fresh-eyes finding)", () => {
    const plan = planDeliveryReceive({ lines: [line("x", "cancelled")], proofPhotoCount: 0 });
    expect(plan.allReceived).toBe(false);
    expect(plan.receivable).toEqual([]);
    expect(plan.receivedCount).toBe(0);
  });

  it("the confirm gate requires at least one PHOTO — a paper PDF alone doesn't open it", () => {
    expect(
      planDeliveryReceive({ lines: [line("a", "on_route")], proofPhotoCount: 0 }).photoGateOpen,
    ).toBe(false);
    expect(
      planDeliveryReceive({ lines: [line("a", "on_route")], proofPhotoCount: 1 }).photoGateOpen,
    ).toBe(true);
  });
});

describe("PoReceiveSection submitBlocked (spec 308)", () => {
  const lines = [
    { id: "pr1", pr_number: 9, item_description: "ทราย", quantity: 2, unit: "คิว", amount: null },
  ];

  it("blocks the submit button and states the reason", () => {
    render(<PoReceiveSection lines={lines} submitBlockedReason={TRUCK_PHOTO_REQUIRED_HINT} />);
    const btn = screen.getByRole("button", { name: /รับเข้าคลัง/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText(TRUCK_PHOTO_REQUIRED_HINT)).toBeInTheDocument();
  });

  it("unblocked renders exactly as before", () => {
    render(<PoReceiveSection lines={lines} />);
    expect(screen.getByRole("button", { name: /รับเข้าคลัง/ })).toBeEnabled();
  });
});

describe("ProofOfDeliveryUploader capture mode (spec 308)", () => {
  it("forces the live rear camera when capture is set", () => {
    const { container } = render(
      <ProofOfDeliveryUploader purchaseOrderId="po1" deliveryId="d1" capture />,
    );
    expect(container.querySelector('input[type="file"]')!.getAttribute("capture")).toBe(
      "environment",
    );
  });

  it("default stays the BO chooser (no capture attr)", () => {
    const { container } = render(<ProofOfDeliveryUploader purchaseOrderId="po1" deliveryId="d1" />);
    expect(container.querySelector('input[type="file"]')!.hasAttribute("capture")).toBe(false);
  });

  it("DeliveryProofBlock default (BO งวด page) stays capture-free", () => {
    const { container } = render(
      <DeliveryProofBlock purchaseOrderId="po1" deliveryId="d1" docs={[]} urls={new Map()} />,
    );
    expect(container.querySelector('input[type="file"]')!.hasAttribute("capture")).toBe(false);
  });

  it("DeliveryProofBlock forwards capture + label to its embedded uploader", () => {
    const { container } = render(
      <DeliveryProofBlock
        purchaseOrderId="po1"
        deliveryId="d1"
        docs={[]}
        urls={new Map()}
        captureUploader
        uploaderLabel="ถ่ายรูปของที่มาส่ง"
      />,
    );
    expect(container.querySelector('input[type="file"]')!.getAttribute("capture")).toBe(
      "environment",
    );
    expect(screen.getByRole("button", { name: "ถ่ายรูปของที่มาส่ง" })).toBeInTheDocument();
  });
});

describe("spec 308 labels", () => {
  it("page title + photo-gate copy exist", () => {
    expect(DELIVERY_RECEIVE_PAGE_TITLE).toBe("รับของ");
    expect(TRUCK_PHOTO_REQUIRED_HINT).toBe(
      "ถ่ายรูปของที่มาส่งอย่างน้อย 1 รูป ก่อนยืนยันรับเข้าคลัง",
    );
  });
});

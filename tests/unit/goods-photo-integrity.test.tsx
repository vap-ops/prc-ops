// Writing failing test first.
//
// Spec 303 — goods-photo integrity. The delivery-confirmation photo is the
// receive proof (spec 24 / ADR 0030), but nothing forced real-time capture
// (no `capture` attr → gallery uploads), coverage was unstated, the
// photos↔amount pairing was invisible, and a photo-less `delivered` (the BO
// checklist path) was silent.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/requests/actions", () => ({
  addDeliveryConfirmationPhoto: vi.fn(),
}));

import { DeliveryPhotoUploader } from "@/components/features/purchasing/delivery-photo-uploader";
import { planRequestDocSections } from "@/lib/purchasing/request-doc-sections";
import {
  DELIVERY_PHOTO_COVERAGE_HINT,
  DELIVERY_PHOTO_MISSING_LABEL,
  deliveredQtyCaption,
} from "@/lib/i18n/labels";

describe("DeliveryPhotoUploader real-time capture (spec 303)", () => {
  it("forces the live rear camera on mobile via capture=environment", () => {
    const { container } = render(
      <DeliveryPhotoUploader purchaseRequestId="pr-1" projectId="proj-1" userId="u-1" />,
    );
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input!.getAttribute("capture")).toBe("environment");
  });

  it("shows the coverage hint — all items, multiple shots fine", () => {
    render(<DeliveryPhotoUploader purchaseRequestId="pr-1" projectId="proj-1" userId="u-1" />);
    expect(screen.getByText(DELIVERY_PHOTO_COVERAGE_HINT)).toBeInTheDocument();
  });
});

describe("spec 303 labels + caption", () => {
  it("coverage + missing-photo copy exist", () => {
    expect(DELIVERY_PHOTO_COVERAGE_HINT).toBe("ถ่ายให้เห็นของที่รับครบทุกรายการ — ถ่ายได้หลายรูป");
    expect(DELIVERY_PHOTO_MISSING_LABEL).toBe("ยังไม่มีรูปยืนยันการรับของ");
  });

  it("the amount-trace caption states the received quantity per PR row", () => {
    expect(deliveredQtyCaption(20, "ถุง")).toBe("จำนวนที่รับ 20 ถุง");
  });
});

describe("planRequestDocSections deliveryPhotoMissingFlag (spec 303)", () => {
  it("flags a delivered PR with zero confirmation photos — every role", () => {
    for (const isBackOffice of [true, false]) {
      expect(
        planRequestDocSections({
          status: "delivered",
          isBackOffice,
          hasPaymentDocs: false,
          hasDeliveryPhotos: false,
        }).deliveryPhotoMissingFlag,
      ).toBe(true);
    }
  });

  it("no flag when photos exist or before delivery", () => {
    expect(
      planRequestDocSections({
        status: "delivered",
        isBackOffice: true,
        hasPaymentDocs: false,
        hasDeliveryPhotos: true,
      }).deliveryPhotoMissingFlag,
    ).toBe(false);
    expect(
      planRequestDocSections({
        status: "on_route",
        isBackOffice: true,
        hasPaymentDocs: false,
        hasDeliveryPhotos: false,
      }).deliveryPhotoMissingFlag,
    ).toBe(false);
  });
});

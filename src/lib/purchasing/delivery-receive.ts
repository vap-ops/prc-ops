// Spec 308 U1 — the pure seam behind the delivery receive page
// (/projects/[id]/incoming/[deliveryId]). Splits the delivery's PR lines into
// still-receivable vs received, and gates the confirm on the required truck
// photo (photo-always doctrine, spec 300/303: no photo-less receive).

import type { PurchaseRequestStatus } from "@/lib/db/enums";

/** In-transit statuses the receive checklist may confirm (spec 134 U5). */
const RECEIVABLE_STATUSES: readonly PurchaseRequestStatus[] = ["purchased", "on_route"];

export interface DeliveryReceiveLine {
  id: string;
  pr_number: number;
  item_description: string;
  quantity: number;
  unit: string;
  status: PurchaseRequestStatus;
}

export interface DeliveryReceivePlan<L extends DeliveryReceiveLine> {
  /** Lines the checklist offers (purchased/on_route). */
  receivable: L[];
  /** Lines already received (delivered). */
  receivedCount: number;
  /**
   * Fully received: nothing left in transit AND something actually landed —
   * an all-cancelled delivery (receivable 0, received 0) is NOT "received".
   */
  allReceived: boolean;
  /** ≥1 delivery-scoped proof PHOTO (kind='image') — confirm may proceed. */
  photoGateOpen: boolean;
}

export function planDeliveryReceive<L extends DeliveryReceiveLine>(input: {
  lines: ReadonlyArray<L>;
  /** Count of image-kind proof docs — PDFs don't satisfy the photo gate. */
  proofPhotoCount: number;
}): DeliveryReceivePlan<L> {
  const receivable = input.lines.filter((l) => RECEIVABLE_STATUSES.includes(l.status));
  const receivedCount = input.lines.filter((l) => l.status === "delivered").length;
  return {
    receivable,
    receivedCount,
    allReceived: receivable.length === 0 && receivedCount > 0,
    photoGateOpen: input.proofPhotoCount > 0,
  };
}

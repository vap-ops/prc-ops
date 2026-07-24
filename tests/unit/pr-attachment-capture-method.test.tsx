// Writing failing test first.
//
// Spec 354 U1 — the two queued pr-attachment enqueue sites each stamp a
// captureMethod onto the queued item. DeliveryPhotoUploader's file input is
// capture="environment" (camera-forced, spec 303) so its enqueued item must
// be "camera". PurchaseRequestAttachmentStager's input has no capture attr
// (plain picker) so "picker" is correct there. This pins both values against
// regression — a prior version had the delivery uploader wrongly riding the
// neutral "picker" placeholder.

import { render, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAddDelivery, mockAddAttachment, mockUpload, mockPrepare, safeQueuePut } = vi.hoisted(
  () => ({
    mockAddDelivery: vi.fn(),
    mockAddAttachment: vi.fn(),
    mockUpload: vi.fn(),
    mockPrepare: vi.fn(),
    safeQueuePut: vi.fn(async () => {}),
  }),
);

vi.mock("@/app/requests/actions", () => ({
  addDeliveryConfirmationPhoto: mockAddDelivery,
  addPurchaseRequestAttachment: mockAddAttachment,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/lib/purchasing/attachment-path", () => ({
  buildPrAttachmentStoragePath: () => "p1/r1/a1.jpg",
}));
vi.mock("@/lib/photos/upload-queue-idb", () => ({
  QUEUE_CHANGED_EVENT: "prc:upload-queue-changed",
  notifyQueueChanged: vi.fn(),
  safeQueuePut,
  safeQueueRemove: vi.fn(async () => {}),
}));

import { DeliveryPhotoUploader } from "@/components/features/purchasing/delivery-photo-uploader";
import { PurchaseRequestAttachmentStager } from "@/components/features/purchasing/purchase-request-attachment-stager";

const file = () => new File(["x"], "photo.jpg", { type: "image/jpeg" });
function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  mockAddDelivery.mockReset().mockResolvedValue({ ok: true });
  mockAddAttachment.mockReset().mockResolvedValue({ ok: true });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpg" });
  safeQueuePut.mockClear();
});

describe("DeliveryPhotoUploader capture method (spec 354 U1)", () => {
  it("enqueues captureMethod camera — the input is capture=environment", async () => {
    const { container } = render(
      <DeliveryPhotoUploader purchaseRequestId="pr-1" projectId="proj-1" userId="u-1" />,
    );
    fireEvent.change(fileInput(container), { target: { files: [file()] } });
    await waitFor(() => expect(mockAddDelivery).toHaveBeenCalledTimes(1));
    expect(safeQueuePut).toHaveBeenCalledWith(expect.objectContaining({ captureMethod: "camera" }));
    // Spec 354 U2: the DIRECT upload (distinct from the queue item above) is
    // also stamped — this is the offline-runner-bypassing happy path.
    expect(mockUpload).toHaveBeenCalledWith(
      "p1/r1/a1.jpg",
      expect.anything(),
      expect.objectContaining({ metadata: { captureMethod: "camera" } }),
    );
  });
});

describe("PurchaseRequestAttachmentStager capture method (spec 354 U1)", () => {
  it("enqueues captureMethod picker — the input has no capture attr", async () => {
    const { container } = render(
      <PurchaseRequestAttachmentStager projectId="proj-1" purchaseRequestId="pr-1" userId="u-1" />,
    );
    fireEvent.change(fileInput(container), { target: { files: [file()] } });
    await waitFor(() => expect(mockAddAttachment).toHaveBeenCalledTimes(1));
    expect(safeQueuePut).toHaveBeenCalledWith(expect.objectContaining({ captureMethod: "picker" }));
  });
});

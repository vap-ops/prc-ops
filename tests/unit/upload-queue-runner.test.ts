// Writing failing test first.
//
// Spec 354 — when the OFFLINE queue runner drains a WP progress photo, it must
// stamp the item's capture affordance into storage.objects.user_metadata via the
// `.upload()` metadata option. The value rides the queue item (QueuedUploadBase),
// so a photo enqueued offline carries its affordance all the way to the deferred
// upload. This drives the item through the runner's real buildDeps + processQueue.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpload, mockGetUser, mockAddPhoto } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockGetUser: vi.fn(),
  mockAddPhoto: vi.fn(),
}));

vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: { from: () => ({ upload: mockUpload }) },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  addPhoto: mockAddPhoto,
}));
vi.mock("@/app/requests/actions", () => ({
  addDeliveryConfirmationPhoto: vi.fn(),
  addPurchaseRequestAttachment: vi.fn(),
}));

import { buildDeps } from "@/components/features/photos/upload-queue-runner";
import { processQueue, type QueuedUpload, type QueueStore } from "@/lib/photos/upload-queue";

class MemoryStore implements QueueStore {
  items = new Map<string, QueuedUpload>();
  async all(): Promise<QueuedUpload[]> {
    return [...this.items.values()];
  }
  async put(item: QueuedUpload): Promise<void> {
    this.items.set(item.id, item);
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
  async has(id: string): Promise<boolean> {
    return this.items.has(id);
  }
  async count(): Promise<number> {
    return this.items.size;
  }
}

function phasePhotoItem(overrides: Partial<QueuedUpload> = {}): QueuedUpload {
  return {
    kind: "phase_photo",
    id: "11111111-0000-4000-8000-000000000001",
    userId: "u1",
    workPackageId: "wp1",
    phase: "after",
    ext: "jpeg",
    blob: new Blob(["x"]),
    lastModifiedMs: 1_000,
    fileName: "a.jpg",
    storagePath: "p1/wp1/x.jpeg",
    step: "upload",
    attempts: 0,
    lastError: null,
    enqueuedAtMs: 0,
    captureMethod: "library",
    ...overrides,
  } as QueuedUpload;
}

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  mockAddPhoto.mockReset().mockResolvedValue({ ok: true });
});

describe("upload-queue-runner buildDeps (spec 354)", () => {
  it("stamps the item's captureMethod into the storage metadata when draining a phase photo", async () => {
    const store = new MemoryStore();
    await store.put(phasePhotoItem({ captureMethod: "library" }));

    const { deps } = await buildDeps();
    const result = await processQueue(store, deps);

    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(mockUpload).toHaveBeenCalledWith(
      "p1/wp1/x.jpeg",
      expect.anything(),
      expect.objectContaining({ metadata: { captureMethod: "library" } }),
    );
  });
});

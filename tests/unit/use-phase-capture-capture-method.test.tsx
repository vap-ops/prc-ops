// Writing failing test first.
//
// Spec 352 — usePhaseCapture is the WP progress-photo engine shared by the two
// capture-sheet inputs (camera shutter / library button). The affordance is
// passed into handleFiles per selection and must (a) ride the queued item so an
// offline drain by the runner still carries it, and (b) be stamped into
// storage.objects.user_metadata on the LIVE (page-open) upload — the common case.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { trackFriction } = vi.hoisted(() => ({ trackFriction: vi.fn() }));
const { uploadMock, addPhotoMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  addPhotoMock: vi.fn(),
}));
const { safeQueuePut, safeQueueRemove, notifyQueueChanged } = vi.hoisted(() => ({
  safeQueuePut: vi.fn(async () => {}),
  safeQueueRemove: vi.fn(async () => {}),
  notifyQueueChanged: vi.fn(),
}));

vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  addPhoto: addPhotoMock,
  removePhoto: vi.fn(),
}));
vi.mock("@/lib/photos/downscale", () => ({
  preparePhotoForUpload: vi.fn(async () => ({ blob: new Blob(["x"]), ext: "jpeg" })),
}));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: uploadMock }) } }),
}));
vi.mock("@/lib/photos/upload-queue-idb", () => ({
  QUEUE_CHANGED_EVENT: "prc:upload-queue-changed",
  notifyQueueChanged,
  safeQueuePut,
  safeQueueRemove,
}));

import { usePhaseCapture } from "@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture";

beforeAll(() => {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = vi.fn(() => "blob:preview") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  }
});

function fileList(files: File[]): FileList {
  const list: Record<number, File> & { length: number } = { length: files.length };
  files.forEach((f, i) => (list[i] = f));
  return list as unknown as FileList;
}

function renderCapture() {
  return renderHook(() =>
    usePhaseCapture({ projectId: "p1", workPackageId: "w1", userId: "u1", phase: "before" }),
  );
}

const IMAGE = () => new File(["img"], "photo.jpg", { type: "image/jpeg" });

afterEach(() => vi.clearAllMocks());

describe("usePhaseCapture capture method (spec 352)", () => {
  it("rides the passed affordance on the enqueued queue item", async () => {
    uploadMock.mockResolvedValue({ error: null });
    addPhotoMock.mockResolvedValue({ ok: true });
    const { result } = renderCapture();

    await act(async () => {
      await result.current.handleFiles(fileList([IMAGE()]), "library");
    });

    expect(safeQueuePut).toHaveBeenCalledWith(
      expect.objectContaining({ captureMethod: "library" }),
    );
  });

  it("stamps the affordance into storage metadata on the live upload", async () => {
    uploadMock.mockResolvedValue({ error: null });
    addPhotoMock.mockResolvedValue({ ok: true });
    const { result } = renderCapture();

    await act(async () => {
      await result.current.handleFiles(fileList([IMAGE()]), "library");
    });

    expect(uploadMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ metadata: { captureMethod: "library" } }),
    );
  });
});

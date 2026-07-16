import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Feedback 10a15ebe — a project_manager could not upload a WP photo: the capture
// sheet looped on "ลองใหม่". Investigation ruled out permissions (role + project
// membership + can_see_wp + storage-role all verified) and the duplicate-object
// case is handled — yet NO telemetry existed for a real field failure, because the
// engine only console.error'd storage/insert errors (contrast the validation_error
// path, which IS tracked). We were blind. This adds an `upload_fail` friction signal
// on the two server-facing failure branches so the next occurrence is diagnosable —
// PDPA-min: a stable {kind, stage} only, NEVER the file name, storage path, or raw
// error message.

const { trackFriction } = vi.hoisted(() => ({ trackFriction: vi.fn() }));
const { uploadMock, addPhotoMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  addPhotoMock: vi.fn(),
}));

vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  addPhoto: addPhotoMock,
  removePhoto: vi.fn(),
}));
// Downscale is the real guard elsewhere; here we mock it so a valid image survives
// preparation and reaches the upload/insert branches under test.
vi.mock("@/lib/photos/downscale", () => ({
  preparePhotoForUpload: vi.fn(async () => ({ blob: new Blob(["x"]), ext: "jpg" })),
}));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: uploadMock }) } }),
}));
vi.mock("@/lib/photos/upload-queue-idb", () => ({
  QUEUE_CHANGED_EVENT: "prc:upload-queue-changed",
  notifyQueueChanged: vi.fn(),
  safeQueuePut: vi.fn(async () => {}),
  safeQueueRemove: vi.fn(async () => {}),
}));

import { usePhaseCapture } from "@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture";

beforeAll(() => {
  // jsdom lacks object-URL support; the upload path calls it for the preview.
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

describe("usePhaseCapture upload_fail friction (feedback 10a15ebe)", () => {
  it("emits upload_fail{stage:storage} when the storage upload fails (not a duplicate)", async () => {
    uploadMock.mockResolvedValue({ error: { message: "network down", statusCode: 500 } });
    const { result } = renderCapture();

    await act(async () => {
      await result.current.handleFiles(fileList([IMAGE()]));
    });

    expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
      kind: "phase_photo",
      stage: "storage",
    });
    expect(result.current.pending[0]?.status).toBe("upload-error");
  });

  it("emits upload_fail{stage:insert} when the metadata insert is rejected", async () => {
    uploadMock.mockResolvedValue({ error: null });
    addPhotoMock.mockResolvedValue({ ok: false, error: "บันทึกรูปไม่สำเร็จ" });
    const { result } = renderCapture();

    await act(async () => {
      await result.current.handleFiles(fileList([IMAGE()]));
    });

    expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
      kind: "phase_photo",
      stage: "insert",
    });
    expect(result.current.pending[0]?.status).toBe("insert-error");
  });

  it("does NOT emit upload_fail when the upload and insert both succeed", async () => {
    uploadMock.mockResolvedValue({ error: null });
    addPhotoMock.mockResolvedValue({ ok: true });
    const { result } = renderCapture();

    await act(async () => {
      await result.current.handleFiles(fileList([IMAGE()]));
    });

    expect(trackFriction).not.toHaveBeenCalledWith("upload_fail", expect.anything());
  });
});

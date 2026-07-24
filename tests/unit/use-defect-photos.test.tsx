// Writing failing test first.
//
// Spec 248 U2 — the defect-photo upload engine for the รายงานข้อบกพร่อง form.
// Deliberately NOT the offline-queue engine (usePhaseCapture): defect filing is
// ONLINE-ONLY (design blocker: a queued replay could stamp a closed round's
// evidence), so this hook is a straight downscale → browser-direct Storage
// upload → hold; metadata rows are inserted only AFTER the reopen RPC succeeds
// (attachAll), so every row lands on the freshly-bumped round.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpload, mockAddPhoto, mockPrepare } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockAddPhoto: vi.fn(),
  mockPrepare: vi.fn(),
}));

vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: mockUpload }) },
  }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  addPhoto: mockAddPhoto,
}));

import { useDefectPhotos } from "@/app/projects/[projectId]/work-packages/[workPackageId]/use-defect-photos";

function fileList(...files: File[]): FileList {
  return files as unknown as FileList;
}

const JPEG = new File(["x"], "defect.jpg", { type: "image/jpeg", lastModified: 1700000000000 });

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockAddPhoto.mockReset().mockResolvedValue({ ok: true });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
});

describe("useDefectPhotos (spec 248 U2)", () => {
  it("downscales + uploads bytes on selection, then holds the photo as ready", async () => {
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("ready"));
    expect(mockPrepare).toHaveBeenCalledOnce();
    expect(mockUpload).toHaveBeenCalledOnce();
    // No metadata insert yet — that waits for the RPC (attachAll).
    expect(mockAddPhoto).not.toHaveBeenCalled();
  });

  it("stamps captureMethod 'picker' into storage metadata on upload (spec 352)", async () => {
    // Defect photos come from a plain <input accept> with no `capture` and no
    // library affordance split — the input tapped is ambiguous, so "picker".
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("ready"));
    expect(mockUpload).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ metadata: { captureMethod: "picker" } }),
    );
  });

  it("marks a failed byte upload upload-error and exposes retry", async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: "boom" } });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    // A stuck photo must keep the submit blocked — evidence is never silently
    // dropped at submit (review MEDIUM).
    expect(result.current.anyInFlight).toBe(true);
    mockUpload.mockResolvedValueOnce({ error: null });
    await act(() => result.current.retry(result.current.photos[0]!.id));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("ready"));
  });

  it("treats an already-exists retry as success (bytes landed, response lost)", async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: "boom" } });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    // Storage 409: the object actually landed on the first (lost-response) try.
    mockUpload.mockResolvedValueOnce({
      error: { message: "The resource already exists", statusCode: "409" },
    });
    await act(() => result.current.retry(result.current.photos[0]!.id));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("ready"));
  });

  it("attachAll inserts each ready photo as a defect-phase row and reports zero failures", async () => {
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("ready"));

    let failed = -1;
    await act(async () => {
      failed = await result.current.attachAll();
    });
    expect(failed).toBe(0);
    expect(mockAddPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ workPackageId: "wp1", phase: "defect", ext: "jpeg" }),
    );
    expect(result.current.photos[0]?.status).toBe("saved");
  });

  it("a failed metadata insert becomes insert-error, is retriable, and counts as failed", async () => {
    mockAddPhoto.mockResolvedValueOnce({ ok: false, error: "x" });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("ready"));

    let failed = -1;
    await act(async () => {
      failed = await result.current.attachAll();
    });
    expect(failed).toBe(1);
    expect(result.current.photos[0]?.status).toBe("insert-error");

    mockAddPhoto.mockResolvedValueOnce({ ok: true });
    await act(() => result.current.retry(result.current.photos[0]!.id));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("saved"));
  });

  it("remove drops a pre-submit photo from the list (Storage orphan accepted)", async () => {
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    act(() => result.current.remove(result.current.photos[0]!.id));
    expect(result.current.photos).toHaveLength(0);
  });

  it("anyInFlight is true while bytes are uploading (submit must stay blocked)", async () => {
    let resolveUpload: (v: { error: null }) => void = () => {};
    mockUpload.mockReturnValueOnce(
      new Promise((res) => {
        resolveUpload = res;
      }),
    );
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    // Deliberately NOT awaited — the upload promise is still pending.
    let inFlight: Promise<void>;
    act(() => {
      inFlight = result.current.handleFiles(fileList(JPEG));
    });
    await waitFor(() => expect(result.current.anyInFlight).toBe(true));
    resolveUpload({ error: null });
    await act(async () => {
      await inFlight;
    });
    await waitFor(() => expect(result.current.anyInFlight).toBe(false));
  });
});

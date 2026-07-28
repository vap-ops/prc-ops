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

// Writing failing test first.
//
// Third surface of the 2026-07-28 honest-copy class (#823 catalog, #826 phase
// capture). This one is the worst of the three: the defect form is ONLINE-ONLY,
// so there is no offline queue to fall back on; `anyInFlight` counts
// upload-error, so a failed photo BLOCKS the submit; and the tile renders ลองใหม่
// INSTEAD of ลบ for an errored photo. A 403/413 therefore traps the whole defect
// report — retry can never succeed and the photo cannot be removed.
describe("useDefectPhotos — a permanent storage refusal (sibling of #823/#826)", () => {
  it("names an RLS denial instead of inviting a retry, and marks it terminal", async () => {
    mockUpload.mockResolvedValue({
      error: { message: "new row violates row-level security policy", statusCode: "403" },
    });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    const photo = result.current.photos[0]!;
    expect(photo.terminal).toBe(true);
    expect(photo.errorMessage).toContain("สิทธิ์ไม่พอ");
    expect(photo.errorMessage).not.toContain("ลองใหม่");
  });

  it("names an over-size file as terminal too", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Payload too large", statusCode: 413 } });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    expect(result.current.photos[0]?.terminal).toBe(true);
    expect(result.current.photos[0]?.errorMessage).toContain("ไฟล์ใหญ่เกินไป");
  });

  it("leaves a 401 RETRYABLE — an expired JWT refreshes and the next attempt lands", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Unauthorized", statusCode: 401 } });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    expect(result.current.photos[0]?.terminal).toBe(false);
    expect(result.current.photos[0]?.errorMessage).toContain("ลองใหม่");
  });

  it("leaves a transient 5xx retryable with the original copy", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Internal Error", statusCode: 500 } });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    expect(result.current.photos[0]?.terminal).toBe(false);
    expect(result.current.photos[0]?.errorMessage).toContain("ลองใหม่");
  });
});

// Writing failing test first (review findings on the block above).
describe("useDefectPhotos — the terminal photo blocks submit until it is removed", () => {
  it("keeps anyInFlight TRUE while a refused photo sits in the list, and clears it on remove", async () => {
    // This is the commit's central claim and nothing asserted it: the submit gate
    // counts upload-error, so ลบ is not a nicety — it is what unblocks the form.
    mockUpload.mockResolvedValue({
      error: { message: "new row violates row-level security policy", statusCode: "403" },
    });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    expect(result.current.anyInFlight).toBe(true);

    const id = result.current.photos[0]!.id;
    act(() => result.current.remove(id));
    await waitFor(() => expect(result.current.photos).toHaveLength(0));
    expect(result.current.anyInFlight).toBe(false);
  });

  it("tells a picker surface to CHOOSE another file, never to re-shoot", async () => {
    // This form is <input type=file accept=image/*> with no `capture` — the hook
    // records the method as "picker" for exactly that reason. "ถ่ายใหม่" (re-shoot)
    // names an affordance this screen does not have.
    mockUpload.mockResolvedValue({ error: { message: "Payload too large", statusCode: 413 } });
    const { result } = renderHook(() => useDefectPhotos({ projectId: "p1", workPackageId: "wp1" }));
    await act(() => result.current.handleFiles(fileList(JPEG)));

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("upload-error"));
    expect(result.current.photos[0]?.errorMessage).toContain("เลือกรูปใหม่");
    expect(result.current.photos[0]?.errorMessage).not.toContain("ถ่ายใหม่");
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Spec 244 U2b-2 — selecting a file the app rejects (not a supported image) on the
// photo-capture flow is a client-side VALIDATION failure the user sees inline. That
// is a `validation_error` friction signal on the core SA flow. We assert the hook
// emits it once per rejected file, with a PDPA-minimized context (a stable reason
// code only — NEVER the file name/content), and still surfaces the existing
// top-level error. The tracker stamps the route server-agnostically, so no route is
// passed here.
//
// The rejected-file path `continue`s before any upload/insert, so it never touches
// Storage, the offline queue, or the server actions — we mock `./actions` only to
// keep the server import chain out of jsdom; preparePhotoForUpload is the REAL guard
// (returns null for a non-image MIME).

const { trackFriction } = vi.hoisted(() => ({ trackFriction: vi.fn() }));
vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  addPhoto: vi.fn(),
  removePhoto: vi.fn(),
}));

import { usePhaseCapture } from "@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture";

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

afterEach(() => vi.clearAllMocks());

describe("usePhaseCapture validation_error friction (spec 244 U2b-2)", () => {
  it("emits validation_error (reason only, no file name) when a file is not a supported image", async () => {
    const { result } = renderCapture();
    const bad = new File(["x"], "secret-notes.pdf", { type: "application/pdf" });

    await act(async () => {
      await result.current.handleFiles(fileList([bad]));
    });

    expect(trackFriction).toHaveBeenCalledTimes(1);
    expect(trackFriction).toHaveBeenCalledWith("validation_error", {
      reason: "unsupported_file_type",
    });
    // existing UX behavior preserved
    expect(result.current.topLevelError).toContain("ไม่ใช่รูปภาพที่รองรับ");
  });

  it("emits once per rejected file (each is its own friction instance)", async () => {
    const { result } = renderCapture();
    const bad1 = new File(["x"], "a.pdf", { type: "application/pdf" });
    const bad2 = new File(["y"], "b.txt", { type: "text/plain" });

    await act(async () => {
      await result.current.handleFiles(fileList([bad1, bad2]));
    });

    expect(trackFriction).toHaveBeenCalledTimes(2);
  });

  it("does not emit when nothing is selected (empty list early-returns)", async () => {
    const { result } = renderCapture();

    await act(async () => {
      await result.current.handleFiles(fileList([]));
      await result.current.handleFiles(null);
    });

    expect(trackFriction).not.toHaveBeenCalled();
  });
});

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Writing failing test first.
//
// Sibling of the 2026-07-28 catalog field bug (#823). usePhaseCapture already
// classifies an authz (403) / size (413) storage refusal as `terminal` — every
// replay meets the same refusal — but the tile rendered the SAME bare "ลองใหม่"
// button as a transient blip and never showed `errorMessage` at all (it is set in
// three places and was read in none). So the one failure the SA cannot fix by
// tapping was the one the sheet told her to tap. The queue runner already names
// both the refusal and the way out (สิทธิ์ไม่พอ / ลบแล้วถ่ายใหม่); the sheet must
// not contradict it.

import type { PendingUpload } from "@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture";

const { usePhaseCaptureMock, retryMock } = vi.hoisted(() => ({
  usePhaseCaptureMock: vi.fn(),
  retryMock: vi.fn(),
}));

vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture", () => ({
  usePhaseCapture: usePhaseCaptureMock,
}));
vi.mock("@/components/features/photos/photo-lightbox", () => ({
  ZoomablePhoto: () => null,
}));

import { CaptureSheet } from "@/app/projects/[projectId]/work-packages/[workPackageId]/capture-sheet";

function pendingItem(overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    fileName: "a.jpg",
    previewUrl: "blob:preview",
    status: "uploading",
    errorMessage: null,
    blob: new Blob(["x"]),
    lastModifiedMs: 0,
    enqueuedAtMs: 0,
    ext: "jpeg",
    storagePath: "p/wp/x.jpeg",
    captureMethod: "picker",
    ...overrides,
  };
}

function mockCapture(pending: PendingUpload[]) {
  usePhaseCaptureMock.mockReturnValue({
    pending,
    topLevelError: null,
    removingId: null,
    confirmRemoveId: null,
    fileInputRef: { current: null },
    handleFiles: vi.fn(),
    retry: retryMock,
    requestRemove: vi.fn(),
    cancelRemove: vi.fn(),
    handleRemoveConfirmed: vi.fn(),
  });
}

function renderSheet() {
  return render(
    <CaptureSheet
      open
      onClose={vi.fn()}
      projectId="p1"
      workPackageId="w1"
      userId="u1"
      activePhase="before"
      onPhaseChange={() => {}}
      phaseSummaries={[{ phase: "before", label: "ก่อน", count: 0 }]}
      photos={[]}
      canDelete={false}
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe("CaptureSheet — a terminal upload failure (sibling of #823)", () => {
  it("shows the reason and offers NO retry when the failure is terminal", () => {
    mockCapture([
      pendingItem({ status: "upload-error", terminal: true, errorMessage: "สิทธิ์ไม่พอ" }),
    ]);
    renderSheet();

    expect(screen.getByText("สิทธิ์ไม่พอ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument();
  });

  it("still offers ลองใหม่ for a retryable failure", () => {
    mockCapture([
      pendingItem({
        status: "upload-error",
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      }),
    ]);
    renderSheet();

    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
  });
});

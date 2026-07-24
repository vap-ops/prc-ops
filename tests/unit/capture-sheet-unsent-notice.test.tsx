import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Feedback 10a15ebe — during the transient storage blip the reporter saw a bare
// "ลองใหม่" on the failed shot and kept re-tapping, because the reassuring global
// queue banner ("saved — will auto-send") is HIDDEN behind the full-screen capture
// sheet (z-50 scrim over the z-30 banner). This asserts the sheet itself tells the
// user their photo is saved and will auto-retry whenever a pending shot has failed,
// so a self-healing transient does not read as a lost photo.

import type { PendingUpload } from "@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture";

const { usePhaseCaptureMock } = vi.hoisted(() => ({ usePhaseCaptureMock: vi.fn() }));

vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture", () => ({
  usePhaseCapture: usePhaseCaptureMock,
}));
// ZoomablePhoto pulls the lightbox stack; not under test here (no loaded photos).
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
    retry: vi.fn(),
    requestRemove: vi.fn(),
    cancelRemove: vi.fn(),
    handleRemoveConfirmed: vi.fn(),
  });
}

function renderSheet() {
  return render(
    <CaptureSheet
      open
      onClose={() => {}}
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

const NOTICE = /บันทึกรูปไว้แล้ว/;

afterEach(() => vi.clearAllMocks());

describe("CaptureSheet unsent-upload reassurance (feedback 10a15ebe)", () => {
  it("shows the saved/auto-retry reassurance when a pending upload has failed", () => {
    mockCapture([pendingItem({ status: "upload-error", errorMessage: "อัปโหลดไม่สำเร็จ" })]);
    renderSheet();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it("shows it for an insert-stage failure too (bytes landed, metadata pending)", () => {
    mockCapture([pendingItem({ status: "insert-error", errorMessage: "บันทึกไม่สำเร็จ" })]);
    renderSheet();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it("does NOT show the reassurance while an upload is merely in progress", () => {
    mockCapture([pendingItem({ status: "uploading" })]);
    renderSheet();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("does NOT promise auto-send for a TERMINAL failure (authz/size/pairing never retry)", () => {
    // A 403/size/pairing failure will fail identically on retry — claiming
    // "will auto-send" there would repeat the spec-201 dishonest-copy bug.
    mockCapture([
      pendingItem({ status: "upload-error", terminal: true, errorMessage: "สิทธิ์ไม่พอ" }),
    ]);
    renderSheet();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});

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
import { TERMINAL_UPLOAD_COPY } from "@/lib/photos/upload-queue";

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
  // The REAL strings the engine writes — a test that invents its own copy proves
  // nothing about what the SA sees.
  it("shows the storage-denial reason and offers NO retry", () => {
    mockCapture([
      pendingItem({
        status: "upload-error",
        terminal: true,
        errorMessage: TERMINAL_UPLOAD_COPY.authz,
      }),
    ]);
    renderSheet();

    expect(screen.getByText(TERMINAL_UPLOAD_COPY.authz)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument();
  });

  it("shows an insert-stage terminal reason too (pairing), still with no retry", () => {
    mockCapture([
      pendingItem({
        status: "insert-error",
        terminal: true,
        errorMessage: TERMINAL_UPLOAD_COPY.pairing,
      }),
    ]);
    renderSheet();

    expect(screen.getByText(TERMINAL_UPLOAD_COPY.pairing)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument();
  });

  it("announces the terminal reason — it is the one failure with no button left", () => {
    mockCapture([
      pendingItem({
        status: "upload-error",
        terminal: true,
        errorMessage: TERMINAL_UPLOAD_COPY.size,
      }),
    ]);
    renderSheet();

    expect(screen.getByRole("alert")).toHaveTextContent(TERMINAL_UPLOAD_COPY.size);
  });

  it("never renders an empty terminal tile — a dimmed photo with no text reads as idle", () => {
    mockCapture([pendingItem({ status: "upload-error", terminal: true, errorMessage: null })]);
    renderSheet();

    expect(screen.getByRole("alert")).toHaveTextContent("ส่งรูปนี้ไม่ได้");
  });

  it("still offers ลองใหม่ for a retryable failure (terminal explicitly false)", () => {
    mockCapture([
      pendingItem({
        status: "upload-error",
        terminal: false,
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      }),
    ]);
    renderSheet();

    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// Writing failing test first.
//
// Last remnant of the honest-copy class. The shutter footer promises
// "บันทึกอัตโนมัติ — ถ่ายต่อได้แม้ไม่มีเน็ต" unconditionally, and since #826 a tile
// 200px above it can read "ส่งรูปนี้ไม่ได้". Both are on screen at once and they
// contradict — but the promise is not simply false: NEW shots really do still save
// and queue. Deleting it would cost the reassurance that stops an SA re-tapping a
// working shutter; the honest move is to SCOPE it while a refused photo is present.
describe("CaptureSheet — the shutter promise must not contradict a refused tile", () => {
  it("scopes the promise to new shots while a refused photo is on screen", () => {
    mockCapture([
      pendingItem({
        status: "upload-error",
        terminal: true,
        errorMessage: TERMINAL_UPLOAD_COPY.authz,
      }),
    ]);
    renderSheet();

    // The unqualified offline promise is gone…
    expect(screen.queryByText(/ถ่ายต่อได้แม้ไม่มีเน็ต/)).not.toBeInTheDocument();
    // …replaced by one that is true of the shots the shutter is about to take.
    expect(screen.getByText(/รูปใหม่บันทึกอัตโนมัติ/)).toBeInTheDocument();
  });

  it("keeps the full promise when nothing has been refused", () => {
    mockCapture([pendingItem({ status: "uploading" })]);
    renderSheet();

    expect(screen.getByText(/ถ่ายต่อได้แม้ไม่มีเน็ต/)).toBeInTheDocument();
  });

  it("keeps the full promise for a merely RETRYABLE failure — that one will send", () => {
    mockCapture([
      pendingItem({
        status: "upload-error",
        terminal: false,
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      }),
    ]);
    renderSheet();

    expect(screen.getByText(/ถ่ายต่อได้แม้ไม่มีเน็ต/)).toBeInTheDocument();
  });
});

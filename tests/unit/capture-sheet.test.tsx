// Writing failing test first.
//
// Spec 96: the WP CaptureSheet shutter is camera-locked (capture="environment").
// Add a secondary "เลือกจากคลังภาพ" control whose file input has NO capture, so it
// opens the photo library — both inputs feed the same usePhaseCapture engine
// (mocked here; the real one pulls in the offline queue + server actions).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandleFiles } = vi.hoisted(() => ({ mockHandleFiles: vi.fn() }));

vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture", () => ({
  usePhaseCapture: () => ({
    pending: [],
    topLevelError: null,
    removingId: null,
    confirmRemoveId: null,
    fileInputRef: { current: null },
    handleFiles: mockHandleFiles,
    retry: vi.fn(),
    requestRemove: vi.fn(),
    cancelRemove: vi.fn(),
    handleRemoveConfirmed: vi.fn(),
  }),
}));

import { CaptureSheet } from "@/app/projects/[projectId]/work-packages/[workPackageId]/capture-sheet";

function renderSheet() {
  return render(
    <CaptureSheet
      open
      onClose={vi.fn()}
      projectId="p1"
      workPackageId="w1"
      userId="u1"
      activePhase="before"
      onPhaseChange={vi.fn()}
      phaseSummaries={[
        { phase: "before", label: "เตรียมงาน", count: 0 },
        { phase: "during", label: "ระหว่างทำ", count: 0 },
        { phase: "after", label: "เสร็จงาน", count: 0 },
      ]}
      photos={[]}
    />,
  );
}

beforeEach(() => mockHandleFiles.mockReset());

describe("CaptureSheet gallery option (spec 96)", () => {
  it("keeps the camera shutter (capture=environment) and adds a no-capture gallery input", () => {
    const { container } = renderSheet();
    expect(screen.getByText("เลือกจากคลังภาพ")).toBeInTheDocument();

    const fileInputs = Array.from(container.querySelectorAll('input[type="file"]'));
    expect(fileInputs).toHaveLength(2);
    expect(fileInputs.some((i) => i.getAttribute("capture") === "environment")).toBe(true);
    expect(fileInputs.filter((i) => !i.hasAttribute("capture"))).toHaveLength(1);
  });

  it("routes a gallery selection through the same handleFiles engine", () => {
    const { container } = renderSheet();
    const gallery = Array.from(container.querySelectorAll('input[type="file"]')).find(
      (i) => !i.hasAttribute("capture"),
    ) as HTMLInputElement;
    fireEvent.change(gallery, {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
    expect(mockHandleFiles).toHaveBeenCalledTimes(1);
  });
});

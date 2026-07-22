// Writing failing test first.
//
// Spec 96: the WP CaptureSheet shutter is camera-locked (capture="environment").
// Add a secondary "เลือกจากคลังภาพ" control whose file input has NO capture, so it
// opens the photo library — both inputs feed the same usePhaseCapture engine
// (mocked here; the real one pulls in the offline queue + server actions).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandleFiles, mockHandleRemoveConfirmed } = vi.hoisted(() => ({
  mockHandleFiles: vi.fn(),
  mockHandleRemoveConfirmed: vi.fn(),
}));

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
    handleRemoveConfirmed: mockHandleRemoveConfirmed,
  }),
}));

// The loaded thumbnails now open the ZoomablePhoto detail (feedback
// 7c3347b3), which imports the server-only markup actions — mock them.
vi.mock("@/app/photo-markups/actions", () => ({
  listPhotoMarkups: vi.fn().mockResolvedValue({ ok: true, markups: [] }),
  addPhotoMarkup: vi.fn(),
  removePhotoMarkup: vi.fn(),
}));

import { CaptureSheet } from "@/app/projects/[projectId]/work-packages/[workPackageId]/capture-sheet";
import type { SheetPhoto } from "@/app/projects/[projectId]/work-packages/[workPackageId]/capture-sheet";

function renderSheet(photos: ReadonlyArray<SheetPhoto> = [], canDelete = true) {
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
        { phase: "before", label: "เตรียมงาน", count: photos.length },
        { phase: "during", label: "ระหว่างทำ", count: 0 },
        { phase: "after", label: "เสร็จงาน", count: 0 },
      ]}
      photos={photos}
      canDelete={canDelete}
    />,
  );
}

const LOADED: SheetPhoto = {
  id: "photo-1-id",
  url: "https://example.test/storage/photo-1.jpg",
  // Spec 340 U2 — the stable per-phase number rendered on the tile.
  seq: 1,
  timeLabel: "09:00",
};

beforeEach(() => {
  mockHandleFiles.mockReset();
  mockHandleRemoveConfirmed.mockReset();
});

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

// Feedback 7c3347b3 — the delete affordance moves OFF the grid thumbnail
// (where a mis-tap could wipe an upload) and INTO the photo detail. A
// loaded tile becomes a tap-to-enlarge trigger; delete lives in the
// opened detail behind a confirm, and still routes through the supersede
// engine (handleRemoveConfirmed).
describe("CaptureSheet delete relocation (feedback 7c3347b3)", () => {
  it("renders a loaded photo as a detail trigger, with no delete on the grid", () => {
    renderSheet([LOADED]);
    expect(screen.getByRole("button", { name: "ดูรูปขยาย" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลบรูป" })).not.toBeInTheDocument();
  });

  it("deletes from inside the opened detail, via the confirm, through the supersede engine", async () => {
    renderSheet([LOADED]);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    // The detail overlay is a next/dynamic chunk — await its delete button.
    fireEvent.click(await screen.findByRole("button", { name: "ลบรูป" }));
    const prompt = screen.getByText("ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้");
    fireEvent.click(
      within(prompt.closest('[role="dialog"]') as HTMLElement).getByRole("button", {
        name: "ลบรูป",
      }),
    );
    expect(mockHandleRemoveConfirmed).toHaveBeenCalledWith("photo-1-id");
  });
});

// Spec 291 U1 — the CaptureSheet delete is gated from the page. canDelete is
// `isPhotoWpDeletable(wp.status) || isRevisionWindowOpen(...)`: false once the WP
// is submitted for approval or complete, EXCEPT while an unanswered ให้แก้ไข ask
// is outstanding (the amendment for feedback f2096ee4). When false the in-detail
// "ลบรูป" affordance is not offered at all; photo_removal_allowed (migration
// 075831) is the backstop, and it additionally requires the caller to be the
// photo's uploader — a check this zone-level flag cannot make.
describe("CaptureSheet submit gate (spec 291 U1)", () => {
  it("offers the in-detail delete while the WP is deletable (canDelete=true)", async () => {
    renderSheet([LOADED], true);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(await screen.findByRole("button", { name: "ลบรูป" })).toBeInTheDocument();
  });

  it("hides the in-detail delete once the WP is locked (canDelete=false)", async () => {
    renderSheet([LOADED], false);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    // Await the overlay chunk (its dialog), then assert the delete is absent.
    await screen.findByRole("dialog", { name: "รูปขยาย" });
    expect(screen.queryByRole("button", { name: "ลบรูป" })).not.toBeInTheDocument();
  });
});

// Spec 340 U2 — the number has to render on the tile, because the tile is what
// the operator screenshots when asking for a photo to be removed. The numbering
// itself is unit-tested on the pure function; this pins that it survives the trip
// into the grid, where a grep-only assertion would not (a `#{photo.seq}` behind a
// false branch or a `hidden` class still greps fine).
describe("photo number badge — spec 340 U2", () => {
  it("renders each loaded photo's number", () => {
    renderSheet([
      { ...LOADED, id: "a", seq: 1 },
      { ...LOADED, id: "b", seq: 4 },
    ]);
    expect(screen.getByText("#1")).toBeInTheDocument();
    // Not #2 — a retired number is exactly what a delete leaves behind, and the
    // grid must show the real one, never a position index.
    expect(screen.getByText("#4")).toBeInTheDocument();
    expect(screen.queryByText("#2")).toBeNull();
  });
});

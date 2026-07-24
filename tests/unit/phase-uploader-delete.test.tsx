// Writing failing test first.
//
// Spec 356 — the ลบรูป affordance was wired ONLY inside the CaptureSheet, so
// tapping a photo on the WP-detail PAGE opened the same overlay view-only and
// users concluded they could not delete. This threads the EXISTING page-level
// canDelete + an onDeletePhoto (→ the existing removePhoto action + a refresh)
// into PhotoCaptureZone's on-page ZoomablePhoto strips (the current-phase recent
// strip + the read-only หลังแก้ไข history strip). No new delete logic; the overlay
// owns the confirm, the action owns the gate + the Thai refusals.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The removal glue calls the real removePhoto server action + router.refresh —
// mock both. (removePhoto is imported by phase-uploader via "./actions"; the
// alias path is the same resolved module, so this intercepts it.)
const { mockRemovePhoto, mockRefresh } = vi.hoisted(() => ({
  mockRemovePhoto: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  removePhoto: mockRemovePhoto,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// The CaptureSheet (rendered closed inside the zone) pulls in the capture
// engine + server actions; mock it so the module graph loads in jsdom.
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/use-phase-capture", () => ({
  usePhaseCapture: () => ({
    pending: [],
    topLevelError: null,
    removingId: null,
    confirmRemoveId: null,
    fileInputRef: { current: null },
    handleFiles: vi.fn(),
    retry: vi.fn(),
    requestRemove: vi.fn(),
    cancelRemove: vi.fn(),
    handleRemoveConfirmed: vi.fn(),
  }),
}));

// The opened ZoomablePhoto detail imports the server-only markup actions — mock.
vi.mock("@/app/photo-markups/actions", () => ({
  listPhotoMarkups: vi.fn().mockResolvedValue({ ok: true, markups: [] }),
  addPhotoMarkup: vi.fn(),
  removePhotoMarkup: vi.fn(),
}));

import {
  PhotoCaptureZone,
  type PhaseData,
  type DefectPairSlot,
} from "@/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader";
import { PHASES } from "@/lib/photos/phases";

type ZonePhoto = PhaseData["photos"][number];

const CURRENT_PHOTO: ZonePhoto = {
  id: "photo-current-id",
  url: "https://example.test/storage/current.jpg",
  seq: 1,
  timeLabel: "09:00",
  uploaderName: null,
};

const AFTER_FIX_PHOTO: ZonePhoto = {
  id: "photo-afterfix-id",
  url: "https://example.test/storage/afterfix.jpg",
  seq: 1,
  timeLabel: "10:00",
  uploaderName: null,
};

function renderZone(
  props: {
    canDelete?: boolean;
    currentPhotos?: ReadonlyArray<ZonePhoto>;
    afterFixPhotos?: ReadonlyArray<ZonePhoto>;
    showAfterFixCapture?: boolean;
    showAfterFixHistory?: boolean;
    defectPairs?: ReadonlyArray<DefectPairSlot> | null;
  } = {},
) {
  const zonePhases: PhaseData[] = PHASES.map(({ phase, label }) => ({
    phase,
    label,
    photos:
      phase === "before"
        ? (props.currentPhotos ?? [])
        : phase === "after_fix"
          ? (props.afterFixPhotos ?? [])
          : [],
    lastUpdatedLabel: null,
  }));
  return render(
    <PhotoCaptureZone
      projectId="p1"
      workPackageId="w1"
      userId="u1"
      phases={zonePhases}
      currentPhase="before"
      showAfterFixCapture={props.showAfterFixCapture ?? false}
      showAfterFixHistory={props.showAfterFixHistory ?? false}
      currentReworkRound={0}
      canDelete={props.canDelete ?? true}
      removedTrace={[]}
      defectPairs={props.defectPairs ?? null}
    />,
  );
}

beforeEach(() => {
  mockRemovePhoto.mockReset();
  mockRemovePhoto.mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("Spec 356 — delete from the WP-page current-phase strip", () => {
  it("offers ลบรูป in the opened detail when the WP is deletable (canDelete=true)", async () => {
    renderZone({ canDelete: true, currentPhotos: [CURRENT_PHOTO] });
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(await screen.findByRole("button", { name: "ลบรูป" })).toBeInTheDocument();
  });

  it("hides ลบรูป once the WP is locked (canDelete=false)", async () => {
    renderZone({ canDelete: false, currentPhotos: [CURRENT_PHOTO] });
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    // Await the overlay chunk, then assert the delete is absent.
    await screen.findByRole("dialog", { name: "รูปขยาย" });
    expect(screen.queryByRole("button", { name: "ลบรูป" })).not.toBeInTheDocument();
  });

  it("deletes through the existing removePhoto action + refreshes on success", async () => {
    renderZone({ canDelete: true, currentPhotos: [CURRENT_PHOTO] });
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    fireEvent.click(await screen.findByRole("button", { name: "ลบรูป" }));
    const prompt = screen.getByText("ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้");
    fireEvent.click(
      within(prompt.closest('[role="dialog"]') as HTMLElement).getByRole("button", {
        name: "ลบรูป",
      }),
    );
    await waitFor(() =>
      expect(mockRemovePhoto).toHaveBeenCalledWith({ photoLogId: "photo-current-id" }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("surfaces the action's Thai refusal on the zone when the delete fails", async () => {
    mockRemovePhoto.mockResolvedValue({ ok: false, error: "งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้" });
    renderZone({ canDelete: true, currentPhotos: [CURRENT_PHOTO] });
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    fireEvent.click(await screen.findByRole("button", { name: "ลบรูป" }));
    const prompt = screen.getByText("ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้");
    fireEvent.click(
      within(prompt.closest('[role="dialog"]') as HTMLElement).getByRole("button", {
        name: "ลบรูป",
      }),
    );
    expect(await screen.findByText("งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("Spec 356 — delete from the read-only หลังแก้ไข history strip", () => {
  it("offers ลบรูป on a history photo when the WP is deletable (recall case)", async () => {
    // A reworked WP pulled back to an editable status shows past after_fix
    // photos in the read-only history strip while canDelete is true — the
    // history strip must still offer the delete.
    renderZone({
      canDelete: true,
      showAfterFixCapture: false,
      showAfterFixHistory: true,
      afterFixPhotos: [AFTER_FIX_PHOTO],
    });
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    fireEvent.click(await screen.findByRole("button", { name: "ลบรูป" }));
    const prompt = screen.getByText("ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้");
    fireEvent.click(
      within(prompt.closest('[role="dialog"]') as HTMLElement).getByRole("button", {
        name: "ลบรูป",
      }),
    );
    await waitFor(() =>
      expect(mockRemovePhoto).toHaveBeenCalledWith({ photoLogId: "photo-afterfix-id" }),
    );
  });
});

describe("Spec 356 — scope: the PM's defect reference photos stay view-only", () => {
  it("does not offer ลบรูป on a defect-pair reference thumbnail", async () => {
    renderZone({
      canDelete: true,
      currentPhotos: [],
      defectPairs: [
        {
          defectPhotoId: "defect-1",
          defectUrl: "https://example.test/storage/defect.jpg",
          answered: false,
          answerUrl: null,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    await screen.findByRole("dialog", { name: "รูปขยาย" });
    expect(screen.queryByRole("button", { name: "ลบรูป" })).not.toBeInTheDocument();
  });
});

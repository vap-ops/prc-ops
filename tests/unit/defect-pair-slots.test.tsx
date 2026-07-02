// Writing failing test first.
//
// Spec 248 U3 — the paired-capture slots in the SA capture zone. Each current-
// round defect photo shows its answer state: unanswered → a "ถ่ายรูปแก้ไข
// (มุมเดิม)" slot that opens the shutter LOCKED to after_fix with the defect
// photo as the framing reference; answered → the check + thumbnail. While any
// pair is unanswered, the free after_fix capture paths REDIRECT to the first
// unanswered slot (muscle-memory unpaired shots can never satisfy the U4 gate).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

import {
  PhotoCaptureZone,
  type DefectPairSlot,
  type PhaseData,
} from "@/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader";
import { PHASES } from "@/lib/photos/phases";

const phases: PhaseData[] = PHASES.map(({ phase, label }) => ({
  phase,
  label,
  photos: [],
  lastUpdatedLabel: null,
}));

function renderZone(defectPairs: ReadonlyArray<DefectPairSlot> | null) {
  return render(
    <PhotoCaptureZone
      projectId="p1"
      workPackageId="w1"
      userId="u1"
      phases={phases}
      currentPhase="after"
      showAfterFix
      currentReworkRound={2}
      defectPairs={defectPairs}
    />,
  );
}

const unansweredPair: DefectPairSlot = {
  defectPhotoId: "d1",
  defectUrl: "https://signed/d1",
  answered: false,
  answerUrl: null,
};
const answeredPair: DefectPairSlot = {
  defectPhotoId: "d2",
  defectUrl: "https://signed/d2",
  answered: true,
  answerUrl: "https://signed/f2",
};

describe("PhotoCaptureZone defect pair slots (spec 248 U3)", () => {
  it("renders no slots section without pairs", () => {
    renderZone(null);
    expect(screen.queryByText(/จุดบกพร่องที่ต้องแก้/)).not.toBeInTheDocument();
  });

  it("renders a slot per pair with the remaining count", () => {
    renderZone([unansweredPair, answeredPair]);
    expect(screen.getByText(/จุดบกพร่องที่ต้องแก้/)).toHaveTextContent("เหลือ 1");
    expect(screen.getByRole("button", { name: /ถ่ายรูปแก้ไข \(มุมเดิม\)/ })).toBeInTheDocument();
    expect(screen.getByText("แก้ไขแล้ว")).toBeInTheDocument();
  });

  it("tapping an unanswered slot opens the shutter in paired mode with the reference", () => {
    renderZone([unansweredPair]);
    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูปแก้ไข \(มุมเดิม\)/ }));
    // Paired sheet: reference instruction visible, phase switcher hidden.
    expect(screen.getByText(/จากมุมเดิม/)).toBeInTheDocument();
    expect(screen.getByAltText("รูปข้อบกพร่องที่ต้องแก้")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "เลือกช่วงงาน" })).not.toBeInTheDocument();
  });

  it("redirects the free after_fix tile to the first unanswered slot while pairs are pending", () => {
    renderZone([unansweredPair]);
    fireEvent.click(screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" }));
    // Lands in PAIRED mode (reference shown), not the free shutter.
    expect(screen.getByAltText("รูปข้อบกพร่องที่ต้องแก้")).toBeInTheDocument();
  });

  it("keeps the free after_fix shutter once every pair is answered", () => {
    renderZone([answeredPair]);
    fireEvent.click(screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" }));
    expect(screen.queryByAltText("รูปข้อบกพร่องที่ต้องแก้")).not.toBeInTheDocument();
    // Free sheet keeps the phase switcher.
    expect(screen.getByRole("radiogroup", { name: "เลือกช่วงงาน" })).toBeInTheDocument();
  });

  it("redirects the IN-SHEET after_fix switch to paired mode while pairs are pending", () => {
    // Review major (found by all 4 lenses): the sheet's own phase switcher was
    // an un-redirected free after_fix path — open the sheet on a lifecycle
    // phase, then switch to หลังแก้ไข inside it.
    renderZone([unansweredPair]);
    fireEvent.click(screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" }));
    fireEvent.click(screen.getByRole("radio", { name: /หลังแก้ไข/ }));
    expect(screen.getByAltText("รูปข้อบกพร่องที่ต้องแก้")).toBeInTheDocument();
  });
});

// Feedback 0fa23307 — the capture zone must offer a tappable หลังแก้ไข
// (after_fix) bucket: a 4th tile, always available (it's a rework addendum, not
// a future-locked phase in the before→during→after chain).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The CaptureSheet (rendered closed inside the zone) pulls in the capture engine
// + server actions; mock it so the module graph loads in jsdom.
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
  type PhaseData,
} from "@/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader";
import { PHASES } from "@/lib/photos/phases";

const phases: PhaseData[] = PHASES.map(({ phase, label }) => ({
  phase,
  label,
  photos: [],
  lastUpdatedLabel: null,
}));

describe("PhotoCaptureZone after_fix tile (feedback 0fa23307)", () => {
  it("renders a tappable หลังแก้ไข capture tile alongside the three lifecycle phases", () => {
    render(
      <PhotoCaptureZone
        projectId="p1"
        workPackageId="w1"
        userId="u1"
        phases={phases}
        currentPhase="before"
      />,
    );
    // all four capture tiles present
    expect(screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" })).toBeInTheDocument();
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    expect(afterFix).toBeInTheDocument();
    // available, not locked-out (the tile is always tappable)
    expect(afterFix).toBeEnabled();
  });

  it("separates หลังแก้ไข from the lifecycle row — it is a rework addendum, not a 4th sequential phase", () => {
    render(
      <PhotoCaptureZone
        projectId="p1"
        workPackageId="w1"
        userId="u1"
        phases={phases}
        currentPhase="before"
      />,
    );
    const before = screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" });
    const after = screen.getByRole("button", { name: "ถ่ายรูป แล้วเสร็จ" });
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    // The three lifecycle tiles share one switcher grid…
    const lifecycleGrid = before.parentElement;
    expect(lifecycleGrid).toContainElement(after);
    // …and หลังแก้ไข lives OUTSIDE it (its own divided-off line).
    expect(lifecycleGrid).not.toContainElement(afterFix);
  });
});

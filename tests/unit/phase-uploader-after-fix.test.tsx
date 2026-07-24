// Feedback 0fa23307 — the capture zone offers a tappable หลังแก้ไข (after_fix)
// bucket: a rework addendum, divided off from the before→during→after chain.
//
// Spec 353 — the ONE showAfterFix boolean split in two: showAfterFixCapture drives
// the shutter tile (rework cycle only), showAfterFixHistory the read-only strip
// (any WP that carries past after_fix photos). A completed WP keeps its history but
// offers no shutter.

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

function renderZone(
  props: {
    showAfterFixCapture?: boolean;
    showAfterFixHistory?: boolean;
    currentReworkRound?: number;
    afterFixPhotos?: PhaseData["photos"];
  } = {},
) {
  const zonePhases: PhaseData[] = PHASES.map(({ phase, label }) => ({
    phase,
    label,
    photos: phase === "after_fix" ? (props.afterFixPhotos ?? []) : [],
    lastUpdatedLabel: null,
  }));
  return render(
    <PhotoCaptureZone
      projectId="p1"
      workPackageId="w1"
      userId="u1"
      phases={zonePhases}
      currentPhase="before"
      showAfterFixCapture={props.showAfterFixCapture ?? true}
      showAfterFixHistory={props.showAfterFixHistory ?? true}
      currentReworkRound={props.currentReworkRound ?? 1}
      canDelete
      removedTrace={[]}
    />,
  );
}

describe("PhotoCaptureZone after_fix tile (feedback 0fa23307, spec 216/353)", () => {
  it("shows a tappable หลังแก้ไข shutter when capture is allowed", () => {
    renderZone({ showAfterFixCapture: true, showAfterFixHistory: true });
    expect(screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" })).toBeInTheDocument();
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    expect(afterFix).toBeInTheDocument();
    expect(afterFix).toBeEnabled();
  });

  it("separates หลังแก้ไข from the lifecycle row — a rework addendum, not a 4th sequential phase", () => {
    renderZone({ showAfterFixCapture: true });
    const before = screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" });
    const after = screen.getByRole("button", { name: "ถ่ายรูป แล้วเสร็จ" });
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    const lifecycleGrid = before.parentElement;
    expect(lifecycleGrid).toContainElement(after);
    expect(lifecycleGrid).not.toContainElement(afterFix);
  });

  it("history-only: shows the past after_fix photos read-only, with NO shutter", () => {
    renderZone({
      showAfterFixCapture: false,
      showAfterFixHistory: true,
      afterFixPhotos: [
        { id: "a1", url: "/x.jpg", seq: 1, timeLabel: "22 ก.ค.", uploaderName: null },
      ],
    });
    // no capture tile…
    expect(screen.queryByRole("button", { name: "ถ่ายรูป หลังแก้ไข" })).not.toBeInTheDocument();
    // …but the past photo still shows (its stable number).
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("hides หลังแก้ไข entirely when there is neither capture nor history", () => {
    renderZone({ showAfterFixCapture: false, showAfterFixHistory: false });
    expect(screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป หลังแก้ไข" })).not.toBeInTheDocument();
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
  });

  it("labels the หลังแก้ไข shutter with the current rework round (multi-rework support)", () => {
    renderZone({ showAfterFixCapture: true, currentReworkRound: 2 });
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    expect(afterFix).toHaveTextContent("รอบ 2");
  });
});

// Spec 341 U1 — the removal trace. The operator kept pre-submit deletion open to
// any project member (an approval queue for a draft photo would not be staffed)
// and bought accountability with visibility instead. photo_logs was already
// recording who removed what; nothing surfaced it.
describe("removal trace (spec 341 U1)", () => {
  it("names the retired number, the remover and the time", () => {
    render(
      <PhotoCaptureZone
        projectId="p1"
        workPackageId="w1"
        userId="u1"
        phases={PHASES.map(({ phase, label }) => ({
          phase,
          label,
          photos: [],
          lastUpdatedLabel: null,
        }))}
        currentPhase="before"
        showAfterFixCapture={false}
        showAfterFixHistory={false}
        currentReworkRound={0}
        canDelete
        removedTrace={[
          { id: "d1", zone: "จุดบกพร่อง", seq: 4, byName: "อรปรีญา", atLabel: "22 ก.ค. 15:30" },
        ]}
      />,
    );
    expect(screen.getByText("ลบไปแล้ว 1 รูป")).toBeInTheDocument();
    expect(screen.getByText(/จุดบกพร่อง #4 · ลบโดย อรปรีญา · 22 ก.ค. 15:30/)).toBeInTheDocument();
  });

  it("says ไม่ทราบชื่อ rather than dropping the entry when the name cannot be resolved", () => {
    render(
      <PhotoCaptureZone
        projectId="p1"
        workPackageId="w1"
        userId="u1"
        phases={PHASES.map(({ phase, label }) => ({
          phase,
          label,
          photos: [],
          lastUpdatedLabel: null,
        }))}
        currentPhase="before"
        showAfterFixCapture={false}
        showAfterFixHistory={false}
        currentReworkRound={0}
        canDelete
        removedTrace={[
          { id: "p2", zone: "ระหว่างทำ", seq: 2, byName: null, atLabel: "22 ก.ค. 09:00" },
        ]}
      />,
    );
    expect(screen.getByText(/#2 · ลบโดย ไม่ทราบชื่อ/)).toBeInTheDocument();
  });

  it("renders nothing at all for a zone that has never lost a photo", () => {
    render(
      <PhotoCaptureZone
        projectId="p1"
        workPackageId="w1"
        userId="u1"
        phases={PHASES.map(({ phase, label }) => ({
          phase,
          label,
          photos: [],
          lastUpdatedLabel: null,
        }))}
        currentPhase="before"
        showAfterFixCapture={false}
        showAfterFixHistory={false}
        currentReworkRound={0}
        canDelete
        removedTrace={[]}
      />,
    );
    expect(screen.queryByText(/ลบไปแล้ว/)).toBeNull();
  });
});

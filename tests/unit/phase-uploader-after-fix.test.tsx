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
  removed: [],
}));

function renderZone(props: { showAfterFix?: boolean; currentReworkRound?: number } = {}) {
  return render(
    <PhotoCaptureZone
      projectId="p1"
      workPackageId="w1"
      userId="u1"
      phases={phases}
      currentPhase="before"
      showAfterFix={props.showAfterFix ?? true}
      currentReworkRound={props.currentReworkRound ?? 1}
      canDelete
    />,
  );
}

describe("PhotoCaptureZone after_fix tile (feedback 0fa23307, spec 216)", () => {
  it("renders a tappable หลังแก้ไข capture tile alongside the three lifecycle phases", () => {
    renderZone();
    expect(screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" })).toBeInTheDocument();
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    expect(afterFix).toBeInTheDocument();
    // available, not locked-out (the tile is always tappable)
    expect(afterFix).toBeEnabled();
  });

  it("separates หลังแก้ไข from the lifecycle row — it is a rework addendum, not a 4th sequential phase", () => {
    renderZone();
    const before = screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" });
    const after = screen.getByRole("button", { name: "ถ่ายรูป แล้วเสร็จ" });
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    // The three lifecycle tiles share one switcher grid…
    const lifecycleGrid = before.parentElement;
    expect(lifecycleGrid).toContainElement(after);
    // …and หลังแก้ไข lives OUTSIDE it (its own divided-off line).
    expect(lifecycleGrid).not.toContainElement(afterFix);
  });

  it("hides หลังแก้ไข entirely when the WP is not in a rework cycle (showAfterFix=false)", () => {
    renderZone({ showAfterFix: false });
    expect(screen.getByRole("button", { name: "ถ่ายรูป เตรียมงาน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป หลังแก้ไข" })).not.toBeInTheDocument();
  });

  it("labels the หลังแก้ไข tile with the current rework round (multi-rework support)", () => {
    renderZone({ currentReworkRound: 2 });
    const afterFix = screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" });
    expect(afterFix).toHaveTextContent("รอบ 2");
  });
});

// Spec 341 U1 — the removal trace. The operator kept pre-submit deletion open to
// any project member (an approval queue for a draft photo would not be staffed)
// and bought accountability with visibility instead. photo_logs was already
// recording who removed what; nothing surfaced it.
describe("removal trace (spec 341 U1)", () => {
  function withRemoved(removed: Array<{ seq: number; byName: string | null; atLabel: string }>) {
    return PHASES.map(({ phase, label }) => ({
      phase,
      label,
      photos: [],
      lastUpdatedLabel: null,
      // Filed under a zone the page is NOT showing — the trace must still surface.
      removed: phase === "after" ? removed : [],
    }));
  }

  it("names the retired number, the remover and the time", () => {
    render(
      <PhotoCaptureZone
        projectId="p1"
        workPackageId="w1"
        userId="u1"
        phases={withRemoved([{ seq: 4, byName: "อรปรีญา", atLabel: "22 ก.ค. 15:30" }])}
        currentPhase="before"
        showAfterFix={false}
        currentReworkRound={0}
        canDelete
      />,
    );
    expect(screen.getByText("ลบไปแล้ว 1 รูป")).toBeInTheDocument();
    // Zone-prefixed AND filed under a tile the page is not showing — the pin for
    // the live-probe defect where a per-zone trace rendered nothing at all.
    expect(screen.getByText(/แล้วเสร็จ #4 · ลบโดย อรปรีญา · 22 ก.ค. 15:30/)).toBeInTheDocument();
  });

  it("says ไม่ทราบชื่อ rather than dropping the entry when the name cannot be resolved", () => {
    // A remover who has left the project still owes the record — an unnamed row
    // must stay visible, never silently vanish.
    render(
      <PhotoCaptureZone
        projectId="p1"
        workPackageId="w1"
        userId="u1"
        phases={withRemoved([{ seq: 2, byName: null, atLabel: "22 ก.ค. 09:00" }])}
        currentPhase="before"
        showAfterFix={false}
        currentReworkRound={0}
        canDelete
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
        phases={withRemoved([])}
        currentPhase="before"
        showAfterFix={false}
        currentReworkRound={0}
        canDelete
      />,
    );
    expect(screen.queryByText(/ลบไปแล้ว/)).toBeNull();
  });
});

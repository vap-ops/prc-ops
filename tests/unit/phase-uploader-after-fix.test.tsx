// Feedback 0fa23307 — the capture zone offers a tappable หลังแก้ไข (after_fix)
// bucket: a rework addendum, divided off from the before→during→after chain.
//
// Spec 353 — the ONE showAfterFix boolean split in two: showAfterFixCapture drives
// the shutter tile (rework cycle only), showAfterFixHistory the read-only strip
// (any WP that carries past after_fix photos). A completed WP keeps its history but
// offers no shutter.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Spec 356 — the zone now wires an on-page delete (removePhoto + router.refresh)
// into its ZoomablePhoto strips, so rendering it needs both mocked.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  removePhoto: vi.fn(),
}));

import {
  PhotoCaptureZone,
  type PhaseData,
} from "@/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader";
import { PHASES } from "@/lib/photos/phases";
import { AFTER_FIX_LEGACY_LABEL, PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";

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

// Operator directive 2026-07-28 — "hide rework and only show it if there is a rework
// rejection". The history strip was the one surface still leaking the rework name onto
// WPs that were never sent back: 21 of them, 151 pre-spec-353 free-capture photos, all
// at rework_round 0. The photos stay (they are real evidence of real work); the rework
// vocabulary — the label AND the redo icon — goes.
describe("after_fix history is named by round, not by phase (2026-07-28)", () => {
  const legacyPhotos = [
    { id: "a1", url: "/x.jpg", seq: 1, timeLabel: "22 ก.ค.", uploaderName: null },
  ];

  it("a never-reworked WP shows the photos under a plain name, with no รอบ and no หลังแก้ไข", () => {
    renderZone({
      showAfterFixCapture: false,
      showAfterFixHistory: true,
      currentReworkRound: 0,
      afterFixPhotos: legacyPhotos,
    });
    expect(screen.getByText(AFTER_FIX_LEGACY_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(PHOTO_PHASE_LABEL.after_fix)).not.toBeInTheDocument();
    // the evidence itself is NOT hidden — that was the whole point of keeping it
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("a genuinely reworked WP keeps the หลังแก้ไข name", () => {
    renderZone({
      showAfterFixCapture: false,
      showAfterFixHistory: true,
      currentReworkRound: 2,
      afterFixPhotos: legacyPhotos,
    });
    expect(screen.getByText(PHOTO_PHASE_LABEL.after_fix)).toBeInTheDocument();
    expect(screen.queryByText(AFTER_FIX_LEGACY_LABEL)).not.toBeInTheDocument();
  });
});

// FIELD BUG 2026-07-28 — the SA hit "ลองใหม่" forever on every หลังแก้ไข shot.
// Spec 353 U2 (4bf4a650) made an after_fix insert permanently uninsertable outside
// a rework cycle, and this zone's TILE honors that (showAfterFixCapture) — but the
// CAPTURE SHEET's own phase switcher was built from the unfiltered phase list, so a
// round-0 WP still offered a หลังแก้ไข chip inside the sheet. Bytes reached Storage,
// the metadata insert was refused, and the item retried forever. The sheet's
// switcher must offer exactly the phases the server will accept.
describe("capture sheet phase switcher honors the after_fix capture gate", () => {
  async function openSheet() {
    await userEvent.click(screen.getByRole("button", { name: "ถ่ายรูป แล้วเสร็จ" }));
    return screen.getByRole("radiogroup", { name: "เลือกช่วงงาน" });
  }

  it("offers NO หลังแก้ไข chip when the WP is not in a rework cycle", async () => {
    renderZone({ showAfterFixCapture: false, showAfterFixHistory: false });
    const group = await openSheet();
    expect(screen.queryByRole("radio", { name: /หลังแก้ไข/ })).not.toBeInTheDocument();
    // …and the three lifecycle phases the server DOES accept are still offered.
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /เตรียมงาน/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ระหว่างทำ/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /แล้วเสร็จ/ })).toBeInTheDocument();
  });

  it("still offers หลังแก้ไข inside a rework cycle, where the insert is accepted", async () => {
    renderZone({ showAfterFixCapture: true, currentReworkRound: 1 });
    await openSheet();
    expect(screen.getByRole("radio", { name: /หลังแก้ไข/ })).toBeInTheDocument();
  });

  it("keeps the chip hidden even when the WP carries past after_fix photos (history is read-only)", async () => {
    renderZone({
      showAfterFixCapture: false,
      showAfterFixHistory: true,
      afterFixPhotos: [
        { id: "a1", url: "/x.jpg", seq: 1, timeLabel: "22 ก.ค.", uploaderName: null },
      ],
    });
    await openSheet();
    expect(screen.queryByRole("radio", { name: /หลังแก้ไข/ })).not.toBeInTheDocument();
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

// Writing failing test first.
//
// Spec 363 U2b — the ประวัติ tab's renderer. The builder is pinned separately
// (wp-timeline.test.ts); this pins what a site admin actually reads on screen:
// the decision COMMENT inline, the collapsed burst's count and span, and the
// filter chips including ของ covering three kinds at once.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WpTimelineView } from "@/components/features/work-packages/wp-timeline-view";
import type { WpTimelineDay } from "@/lib/work-packages/wp-timeline";

const DAYS: WpTimelineDay[] = [
  {
    date: "2026-07-24",
    rows: [
      {
        kind: "decision",
        key: "decision:a1",
        at: "2026-07-24T09:40:00Z",
        actor: "วุฒิพงษ์",
        decision: "needs_revision",
        reason: "mismatch",
        comment: "รูปที่ 3–5 เป็นห้องอื่น",
      },
      {
        kind: "issue",
        key: "issue:i1",
        at: "2026-07-24T02:10:00Z",
        actor: "เล็กครับ",
        item: "ตะแกรงกันร้าว",
        qty: 40,
        unit: "ม.",
      },
    ],
  },
  {
    date: "2026-07-22",
    rows: [
      {
        kind: "photos",
        key: "photos:2026-07-22|during",
        at: "2026-07-22T03:03:00Z",
        until: "2026-07-22T08:47:00Z",
        actor: "อนัญญา",
        phase: "during",
        count: 14,
      },
    ],
  },
];

describe("WpTimelineView", () => {
  it("renders a decision's comment inline — the line the SA needs most", () => {
    render(<WpTimelineView days={DAYS} wpReworkRound={0} />);
    expect(screen.getByText("รูปที่ 3–5 เป็นห้องอื่น")).toBeInTheDocument();
  });

  it("shows a collapsed burst as a count, not as individual photos", () => {
    render(<WpTimelineView days={DAYS} wpReworkRound={0} />);
    expect(screen.getByText(/14 รูป/)).toBeInTheDocument();
  });

  it("filters to one kind when a chip is pressed", () => {
    render(<WpTimelineView days={DAYS} wpReworkRound={0} />);
    fireEvent.click(screen.getByRole("button", { name: "รูป" }));
    expect(screen.queryByText("รูปที่ 3–5 เป็นห้องอื่น")).not.toBeInTheDocument();
    expect(screen.getByText(/14 รูป/)).toBeInTheDocument();
  });

  it("the ของ chip covers withdrawals as well as requests", () => {
    render(<WpTimelineView days={DAYS} wpReworkRound={0} />);
    fireEvent.click(screen.getByRole("button", { name: "ของ" }));
    expect(screen.getByText(/ตะแกรงกันร้าว/)).toBeInTheDocument();
    expect(screen.queryByText(/14 รูป/)).not.toBeInTheDocument();
  });

  it("marks the active chip with aria-pressed so the state is not colour-only", () => {
    render(<WpTimelineView days={DAYS} wpReworkRound={0} />);
    expect(screen.getByRole("button", { name: "ทั้งหมด" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(screen.getByRole("button", { name: "ตรวจ" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ทั้งหมด" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows one time, not a range, when a burst starts and ends in the same displayed minute", () => {
    // Live case that prompted this: two captures 40s apart rendered "19:12–19:12",
    // which reads as a bug to the person holding the phone.
    render(
      <WpTimelineView
        wpReworkRound={0}
        days={[
          {
            date: "2026-07-24",
            rows: [
              {
                kind: "photos",
                key: "photos:2026-07-24|during",
                at: "2026-07-24T12:12:05Z",
                until: "2026-07-24T12:12:45Z",
                actor: "อรปรีญา",
                phase: "during",
                count: 2,
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.queryByText(/(\d{2}:\d{2})–\1/)).not.toBeInTheDocument();
  });

  it("shows an empty state when a filter matches nothing", () => {
    render(<WpTimelineView days={DAYS} wpReworkRound={0} />);
    fireEvent.click(screen.getByRole("button", { name: "สถานะ" }));
    expect(screen.getByText("ยังไม่มีประวัติ")).toBeInTheDocument();
  });

  it("shows an empty state for a work package with no history at all", () => {
    render(<WpTimelineView days={[]} wpReworkRound={0} />);
    expect(screen.getByText("ยังไม่มีประวัติ")).toBeInTheDocument();
  });
});

// Spec 363 U2a — status rows. The view's switch ends in `default: return null`,
// so a new kind renders NOTHING while typecheck stays green — green because
// invisible. These pin that the row actually reaches the screen.
describe("WpTimelineView — status transitions (spec 363 U2a)", () => {
  function renderWithStatus(over: Partial<Record<string, unknown>> = {}) {
    render(
      <WpTimelineView
        wpReworkRound={0}
        days={[
          {
            date: "2026-07-20",
            rows: [
              {
                kind: "status",
                key: "status:1",
                at: "2026-07-20T03:00:00Z",
                actor: "สมชาย",
                from: "in_progress",
                to: "pending_approval",
                round: 0,
                ...over,
              } as never,
            ],
          },
        ]}
      />,
    );
  }

  it("renders the transition using the Thai status labels, not the raw enum", () => {
    renderWithStatus();
    expect(screen.getByText(/รออนุมัติ/)).toBeInTheDocument();
    expect(screen.queryByText(/pending_approval/)).toBeNull();
    expect(screen.queryByText(/in_progress/)).toBeNull();
  });

  it("names who moved it", () => {
    renderWithStatus();
    expect(screen.getByText(/สมชาย/)).toBeInTheDocument();
  });

  it("survives an unknown status string rather than rendering blank", () => {
    // The enum can grow; an unmapped value must degrade to itself, not vanish.
    renderWithStatus({ to: "some_new_status" });
    expect(screen.getByText(/some_new_status/)).toBeInTheDocument();
  });

  it("shows the row under the สถานะ filter", () => {
    renderWithStatus();
    fireEvent.click(screen.getByRole("button", { name: "สถานะ" }));
    expect(screen.getByText(/รออนุมัติ/)).toBeInTheDocument();
  });
});

// Operator directive 2026-07-28 — "hide rework and only show it if there is a rework
// rejection". The ประวัติ photo-burst row named its bucket straight from
// PHOTO_PHASE_LABEL, so on the 21 never-reworked WPs that carry legacy after_fix rows
// it read "ถ่ายรูป หลังแก้ไข · N รูป" — rework vocabulary on a WP that was never sent
// back. Caught by an SSR probe on real data AFTER the other two surfaces were fixed:
// the same rule had a third home. Same helper, so the three cannot drift.
describe("ประวัติ names an after_fix burst by the WP's round (2026-07-28)", () => {
  const afterFixDay: WpTimelineDay[] = [
    {
      date: "2026-07-20",
      rows: [
        {
          kind: "photos",
          key: "photos:2026-07-20|after_fix",
          at: "2026-07-20T04:00:00Z",
          until: "2026-07-20T04:30:00Z",
          actor: "อรปรีญา",
          phase: "after_fix",
          count: 23,
        },
      ],
    },
  ];

  it("a never-reworked WP reads plainly, with no rework vocabulary", () => {
    render(<WpTimelineView days={afterFixDay} wpReworkRound={0} />);
    expect(screen.getByText(/ถ่ายรูป รูปเพิ่มเติม · 23 รูป/)).toBeInTheDocument();
    expect(screen.queryByText(/หลังแก้ไข/)).not.toBeInTheDocument();
  });

  it("a genuinely reworked WP keeps หลังแก้ไข", () => {
    render(<WpTimelineView days={afterFixDay} wpReworkRound={1} />);
    expect(screen.getByText(/ถ่ายรูป หลังแก้ไข · 23 รูป/)).toBeInTheDocument();
  });

  it("leaves the other phases alone", () => {
    render(
      <WpTimelineView
        days={[
          {
            date: "2026-07-20",
            rows: [
              {
                kind: "photos",
                key: "photos:2026-07-20|during",
                at: "2026-07-20T04:00:00Z",
                until: "2026-07-20T04:30:00Z",
                actor: "อนัญญา",
                phase: "during",
                count: 4,
              },
            ],
          },
        ]}
        wpReworkRound={0}
      />,
    );
    expect(screen.getByText(/ถ่ายรูป ระหว่างทำ · 4 รูป/)).toBeInTheDocument();
  });
});

// Spec 183 U1 — the ภาพรวม รอตรวจ hero card. Presentational: takes the
// summary, shows the pending count + oldest-waiting WP and links into the
// /review queue. An empty queue renders calm (no alarm), still a link.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PendingApprovalsCard } from "@/components/features/dashboard/pending-approvals-card";
import type { PendingApprovalsSummary } from "@/lib/approvals/pending-summary";
import { REVIEW_AWAITING_SITE_SHORT } from "@/lib/i18n/labels";

const WITH_PENDING: PendingApprovalsSummary = {
  count: 3,
  awaitingSite: 0,
  oldest: {
    workPackageId: "wp-7",
    wpCode: "WP-07",
    projectCode: "PRJ-014",
    projectName: "อาคาร B",
    waitingSince: "2026-06-20T08:00:00Z",
  },
};

const EMPTY: PendingApprovalsSummary = { count: 0, awaitingSite: 0, oldest: null };

describe("PendingApprovalsCard", () => {
  it("shows the pending count and links to the /review queue", () => {
    render(<PendingApprovalsCard summary={WITH_PENDING} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/review");
    expect(link.textContent).toContain("3");
    expect(link.textContent).toContain("รอตรวจ");
  });

  it("surfaces the oldest-waiting WP (project + WP code)", () => {
    render(<PendingApprovalsCard summary={WITH_PENDING} />);
    const text = screen.getByRole("link").textContent ?? "";
    expect(text).toContain("PRJ-014");
    expect(text).toContain("WP-07");
  });

  it("renders a calm empty state (no count, still a link) when nothing is pending", () => {
    render(<PendingApprovalsCard summary={EMPTY} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/review");
    expect(link.textContent).toContain("ไม่มีงานรอตรวจ");
  });
});

// ---------------------------------------------------------------------------
// Spec 371 U2 — operator 2026-07-28: "Amount 70 items is misleading, how about
// separating them?" The card used to show one blended number. It now shows the
// actionable count as the headline and the waiting-on-site count BESIDE it, so
// neither population hides inside the other.
const WITH_AWAITING: PendingApprovalsSummary = {
  count: 52,
  awaitingSite: 18,
  oldest: {
    workPackageId: "wp-7",
    wpCode: "WP-07",
    projectCode: "PRJ-014",
    projectName: "อาคาร B",
    waitingSince: "2026-06-20T08:00:00Z",
  },
};

const NONE_ACTIONABLE: PendingApprovalsSummary = { count: 0, awaitingSite: 4, oldest: null };

describe("PendingApprovalsCard — the two populations are separated (spec 371 U2)", () => {
  it("headlines the ACTIONABLE count, never the blended total", () => {
    render(<PendingApprovalsCard summary={WITH_AWAITING} />);
    expect(screen.getByText("52")).toBeInTheDocument();
    // 70 is exactly the misleading number this unit exists to stop showing.
    expect(screen.queryByText("70")).not.toBeInTheDocument();
  });

  it("shows the waiting-on-site count as its own figure", () => {
    render(<PendingApprovalsCard summary={WITH_AWAITING} />);
    expect(screen.getByText(/18/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(REVIEW_AWAITING_SITE_SHORT))).toBeInTheDocument();
  });

  it("says nothing about waiting work when there is none", () => {
    render(<PendingApprovalsCard summary={WITH_PENDING} />);
    expect(screen.queryByText(new RegExp(REVIEW_AWAITING_SITE_SHORT))).not.toBeInTheDocument();
  });

  it("stays calm-but-informative when nothing is actionable but work IS waiting", () => {
    // The old card rendered its "ไม่มีงานรอตรวจ" empty state here, which read as
    // "nothing is happening" while four WPs sat with the site.
    render(<PendingApprovalsCard summary={NONE_ACTIONABLE} />);
    expect(screen.getByText(new RegExp(REVIEW_AWAITING_SITE_SHORT))).toBeInTheDocument();
    expect(screen.getByText(/4/)).toBeInTheDocument();
  });
});

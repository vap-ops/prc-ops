// Spec 183 U1 — the ภาพรวม รอตรวจ hero card. Presentational: takes the
// summary, shows the pending count + oldest-waiting WP and links into the
// /review queue. An empty queue renders calm (no alarm), still a link.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PendingApprovalsCard } from "@/components/features/dashboard/pending-approvals-card";
import type { PendingApprovalsSummary } from "@/lib/approvals/pending-summary";

const WITH_PENDING: PendingApprovalsSummary = {
  count: 3,
  oldest: {
    workPackageId: "wp-7",
    wpCode: "WP-07",
    projectCode: "PRJ-014",
    projectName: "อาคาร B",
    waitingSince: "2026-06-20T08:00:00Z",
  },
};

const EMPTY: PendingApprovalsSummary = { count: 0, oldest: null };

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

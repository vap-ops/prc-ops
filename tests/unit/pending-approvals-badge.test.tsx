// Spec 183 U3 — the count badge on the ภาพรวม nav (the "number on the main
// menu"). Two testable parts: the pure formatter (cap + zero-hide) and the
// presentational badge that renders it. The self-fetching wrapper
// (PendingApprovalsBadge) is a thin client island over ApprovalsBadge — its
// network read is best-effort and not unit-tested.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  formatBadgeCount,
  ApprovalsBadge,
} from "@/components/features/dashboard/pending-approvals-badge";

describe("formatBadgeCount", () => {
  it("hides the badge (null) at zero or negative", () => {
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(-3)).toBeNull();
  });

  it("shows the exact count from 1 to 99", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(7)).toBe("7");
    expect(formatBadgeCount(99)).toBe("99");
  });

  it("caps at 99+ above 99", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(2500)).toBe("99+");
  });
});

describe("ApprovalsBadge", () => {
  it("renders nothing when the count is zero", () => {
    const { container } = render(<ApprovalsBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the count with an accessible label when pending", () => {
    render(<ApprovalsBadge count={5} />);
    const badge = screen.getByLabelText("รอตรวจ 5 รายการ");
    expect(badge.textContent).toBe("5");
  });

  it("renders the 99+ cap for large counts", () => {
    render(<ApprovalsBadge count={250} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("uses a custom label in the aria-label (default รอตรวจ)", () => {
    const { rerender } = render(<ApprovalsBadge count={4} />);
    expect(screen.getByLabelText("รอตรวจ 4 รายการ")).toBeInTheDocument();
    rerender(<ApprovalsBadge count={4} label="คำขอซื้อรอพิจารณา" />);
    expect(screen.getByLabelText("คำขอซื้อรอพิจารณา 4 รายการ")).toBeInTheDocument();
  });

  it("overlays the icon by default (absolute), positions inline on request", () => {
    const { rerender } = render(<ApprovalsBadge count={2} />);
    expect(screen.getByLabelText("รอตรวจ 2 รายการ").className).toContain("absolute");
    rerender(<ApprovalsBadge count={2} position="inline" />);
    const inline = screen.getByLabelText("รอตรวจ 2 รายการ");
    expect(inline.className).not.toContain("absolute");
    expect(inline.className).toContain("ml-1");
  });
});

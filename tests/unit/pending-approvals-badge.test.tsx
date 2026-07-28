// Spec 183 U3 — the count badge on the ภาพรวม nav (the "number on the main
// menu"). Two testable parts: the pure formatter (cap + zero-hide) and the
// presentational badge that renders it. The self-fetching wrapper
// (PendingApprovalsBadge) is a thin client island over ApprovalsBadge — its
// network read is best-effort and not unit-tested.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatBadgeCount,
  sumApprovalCounts,
  ApprovalsBadge,
} from "@/components/features/dashboard/pending-approvals-badge";

describe("sumApprovalCounts", () => {
  it("sums the per-type counts, treating null (read failure) as zero", () => {
    expect(sumApprovalCounts([3, 2, 1])).toBe(6);
    expect(sumApprovalCounts([null, 2, null])).toBe(2);
  });

  it("is zero for an empty or all-zero set", () => {
    expect(sumApprovalCounts([])).toBe(0);
    expect(sumApprovalCounts([0, 0, 0])).toBe(0);
  });
});

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

// ---------------------------------------------------------------------------
// Spec 371 U2 — the nav badge summed bare pending_approval with the two bank
// queues, so it reported the blended 70. It now counts the ACTIONABLE zones of
// work_package_review_queue, which is the same predicate /review and the ภาพรวม
// hero read — the three cannot disagree.
describe("the WP term of the badge counts actionable zones only (spec 371 U2)", () => {
  const read = (p: string) =>
    readFileSync(resolve(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const SRC = read("src/components/features/dashboard/pending-approvals-badge.tsx");
  const occurrences = (s: string, n: string) => s.split(n).length - 1;

  it("reads the review-queue view, not the raw work_packages table", () => {
    expect(SRC).toContain("work_package_review_queue");
    // The bare status count is exactly what made the badge misleading.
    expect(SRC).not.toContain('.eq("status", "pending_approval")');
  });

  // Mutation-proved gap: the old pin (`toContain("awaiting_site")` + a loose
  // occurrence count) passed on `.neq("code", "awaiting_site")` — a real column,
  // so TypeScript accepts it, no row matches, and the badge counts 70 again.
  // Pin the FILTERED COLUMN, and pin that the literal comes from the shared
  // const rather than being retyped on this side of the SQL/TS boundary.
  it("filters on the ZONE column, not some other column that happens to compile", () => {
    expect(SRC).toContain('.neq("zone", AWAITING_SITE_ZONE)');
    expect(occurrences(SRC, "AWAITING_SITE_ZONE")).toBeGreaterThanOrEqual(2);
    expect(SRC).not.toContain('.neq("code"');
  });

  // Mutation-proved gap: asserting the two table-name strings exist passed on
  // `sumApprovalCounts([wp, bank, bank])` — worker bank changes dropped, the
  // contractor ones double-counted, every binding still "used" so no lint error.
  it("sums all THREE queues — this unit changes one term, not the shape", () => {
    expect(SRC).toContain("contractor_bank_change_requests");
    expect(SRC).toContain("worker_bank_change_requests");
    expect(SRC).toContain("sumApprovalCounts([wp, bank, workerBank])");
  });
});

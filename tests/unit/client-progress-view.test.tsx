// Writing failing test first.
//
// Spec 233 / ADR 0067 U4 — the read-only client progress surface renders the
// four entitled surfaces and exposes NO edit affordance (logout only).

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: () => null }));

import { ClientProgressView } from "@/components/features/client-portal/client-progress-view";
import type { ClientView } from "@/lib/client-portal/load-client-view";

const view: ClientView = {
  project: {
    id: "p1",
    code: "PRC-1",
    name: "My Project",
    status: "active",
    siteAddress: "Bangkok",
    startDate: "2026-01-01",
    plannedCompletion: "2026-12-31",
  },
  workPackages: [{ id: "wp1", code: "A1", name: "งานเสาเข็ม", status: "complete" }],
  photos: [
    {
      id: "ph1",
      workPackageId: "wp1",
      phase: "after",
      url: "signed://ph1",
      capturedAt: "2026-02-01",
    },
  ],
  reports: [{ id: "r1", createdAt: "2026-03-01", url: "signed://r1" }],
};

describe("ClientProgressView", () => {
  it("renders the four read-only surfaces with a downloadable report link", () => {
    render(<ClientProgressView view={view} />);
    expect(screen.getByRole("heading", { name: "My Project" })).toBeInTheDocument();
    expect(screen.getByText("ความคืบหน้างาน")).toBeInTheDocument();
    expect(screen.getByText(/งานเสาเข็ม/)).toBeInTheDocument();
    expect(screen.getByText("รูปความคืบหน้า")).toBeInTheDocument();
    expect(screen.getByText("รายงานความคืบหน้า")).toBeInTheDocument();
    const reportLink = screen.getByRole("link", { name: /รายงาน/ });
    expect(reportLink).toHaveAttribute("href", "signed://r1");
  });

  it("has no edit / save / delete controls (read-only)", () => {
    render(<ClientProgressView view={view} />);
    expect(screen.queryByRole("button", { name: /บันทึก|แก้ไข|ลบ|ส่ง/ })).toBeNull();
  });
});

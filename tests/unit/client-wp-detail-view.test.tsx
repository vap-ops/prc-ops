// Writing failing test first.
//
// Client WP-detail drill — renders one WP's description, planned dates,
// status, and its own approved photos. Read-only: no edit affordance.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: () => null }));

import { ClientWpDetailView } from "@/components/features/client-portal/client-wp-detail-view";
import type { ClientWpDetailView as ClientWpDetailViewModel } from "@/lib/client-portal/load-client-wp-detail";

const detail: ClientWpDetailViewModel = {
  id: "wp1",
  code: "A1",
  name: "งานเสาเข็ม",
  status: "in_progress",
  description: "หล่อเสาเข็มทั้งหมด 40 ต้น",
  plannedStart: "2026-01-01",
  plannedEnd: "2026-02-01",
  photos: [{ id: "ph1", phase: "after", url: "signed://ph1", capturedAt: "2026-02-01" }],
};

describe("ClientWpDetailView", () => {
  it("renders name, status, description, planned dates, and its photos", () => {
    render(<ClientWpDetailView detail={detail} backHref="/client/p1" />);
    expect(screen.getByRole("heading", { name: /งานเสาเข็ม/ })).toBeInTheDocument();
    expect(screen.getByText("กำลังดำเนินการ")).toBeInTheDocument();
    expect(screen.getByText("หล่อเสาเข็มทั้งหมด 40 ต้น")).toBeInTheDocument();
    const photoLinks = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("aria-label") !== "ย้อนกลับ");
    expect(photoLinks).toHaveLength(1);
    expect(photoLinks[0]).toHaveAttribute("href", "signed://ph1");
  });

  it("renders an empty-photos notice when there are none", () => {
    render(<ClientWpDetailView detail={{ ...detail, photos: [] }} backHref="/client/p1" />);
    expect(screen.getByText("ยังไม่มีรูปที่อนุมัติ")).toBeInTheDocument();
  });

  it("has no edit / save / delete controls (read-only)", () => {
    render(<ClientWpDetailView detail={detail} backHref="/client/p1" />);
    expect(screen.queryByRole("button", { name: /บันทึก|แก้ไข|ลบ|ส่ง/ })).toBeNull();
  });
});

// Writing failing test first.
//
// Spec 316 U2 — RoleDirectory: the /settings/roles list body. Client-side name
// search over the already-loaded user list, grouped sections via the existing
// groupUsersByRole SSOT (visitor promotion queue first), EmptyNotice when the
// query matches nobody.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/settings/roles/actions", () => ({
  setUserRole: vi.fn(async () => ({ ok: true })),
}));

import { RoleDirectory, filterUsersByName } from "@/components/features/roles/role-directory";
import type { RoleUserVM } from "@/components/features/roles/role-admin-list";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

const USERS: RoleUserVM[] = [
  { id: "u1", name: "สมชาย ใจดี", role: "visitor", isSelf: false },
  { id: "u2", name: "สมหญิง เก่งงาน", role: "site_admin", isSelf: false },
  { id: "u3", name: "John Walker", role: "accounting", isSelf: false },
];

describe("filterUsersByName", () => {
  it("matches by substring, case-insensitive; empty query returns all", () => {
    expect(filterUsersByName(USERS, "")).toHaveLength(3);
    expect(filterUsersByName(USERS, "สมหญิง")).toEqual([USERS[1]]);
    expect(filterUsersByName(USERS, "john")).toEqual([USERS[2]]);
    expect(filterUsersByName(USERS, "  สมชาย ")).toEqual([USERS[0]]);
    expect(filterUsersByName(USERS, "ไม่มีจริง")).toEqual([]);
  });
});

describe("RoleDirectory", () => {
  it("renders grouped sections — visitor queue first with its special header", () => {
    render(<RoleDirectory users={USERS} />);
    const headers = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(headers[0]).toContain("รอกำหนดสิทธิ์");
    expect(headers.some((h) => h.includes(USER_ROLE_LABEL.site_admin))).toBe(true);
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
  });

  it("search narrows rows and hides emptied groups; clearing restores", () => {
    render(<RoleDirectory users={USERS} />);
    const box = screen.getByPlaceholderText("ค้นหาชื่อ…");
    fireEvent.change(box, { target: { value: "สมหญิง" } });
    expect(screen.queryByText("สมชาย ใจดี")).not.toBeInTheDocument();
    expect(screen.getByText("สมหญิง เก่งงาน")).toBeInTheDocument();
    expect(screen.queryByText("รอกำหนดสิทธิ์")).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
  });

  it("no match → empty notice", () => {
    render(<RoleDirectory users={USERS} />);
    fireEvent.change(screen.getByPlaceholderText("ค้นหาชื่อ…"), {
      target: { value: "ไม่มีใครชื่อนี้" },
    });
    expect(screen.getByText("ไม่พบผู้ใช้")).toBeInTheDocument();
  });
});

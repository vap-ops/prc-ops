// Component tests for the shared app-shell primitives (spec 17 items A–C):
// AppHeader (the hub-page header in its greeting / fixed-title /
// no-profile-link variants), StatusPill, and the ErrorNotice/EmptyNotice
// pair. These pin the markup contract the nine consuming pages rely on.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppHeader } from "@/components/features/app-header";
import { StatusPill } from "@/components/features/status-pill";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";

describe("AppHeader", () => {
  it("renders the kicker and the greeting with the user's name", () => {
    render(<AppHeader kicker="หน้างาน" fullName="สมชาย" maxWidthClass="max-w-2xl" />);
    expect(screen.getByText("หน้างาน")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("สวัสดี คุณสมชาย");
  });

  it("falls back to a bare greeting without a name", () => {
    render(<AppHeader kicker="หน้างาน" fullName={null} maxWidthClass="max-w-3xl" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^สวัสดี$/);
  });

  it("renders a fixed title instead of the greeting when given", () => {
    // fullName is supplied too — the title must win over the greeting.
    render(
      <AppHeader
        kicker="ผู้จัดการโครงการ"
        title="รายงาน"
        fullName="สมชาย"
        maxWidthClass="max-w-2xl"
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/^รายงาน$/);
    expect(heading).not.toHaveTextContent("สวัสดี");
  });

  it("always shows the profile link (spec 18 normalization — no hide prop)", () => {
    render(<AppHeader kicker="คำขอซื้อ" fullName="สมชาย" maxWidthClass="max-w-3xl" />);
    expect(screen.getByRole("link", { name: "โปรไฟล์" })).toHaveAttribute("href", "/profile");
  });
});

describe("StatusPill", () => {
  it("renders the label inside a pill carrying the palette classes", () => {
    render(
      <StatusPill pillClasses="border-amber-900/60 bg-amber-950/40 text-amber-200">
        รออนุมัติ
      </StatusPill>,
    );
    const pill = screen.getByText("รออนุมัติ");
    expect(pill.className).toContain("rounded-full");
    expect(pill.className).toContain("text-amber-200");
  });

  it("merges extra classes", () => {
    render(
      <StatusPill pillClasses="border-zinc-700 bg-zinc-800 text-zinc-300" className="mt-1">
        เสร็จสิ้น
      </StatusPill>,
    );
    expect(screen.getByText("เสร็จสิ้น").className).toContain("mt-1");
  });
});

describe("notices", () => {
  it("ErrorNotice renders the red strip", () => {
    render(<ErrorNotice>โหลดไม่สำเร็จ</ErrorNotice>);
    const el = screen.getByText("โหลดไม่สำเร็จ");
    expect(el.className).toContain("border-red-900/60");
    expect(el.className).toContain("text-red-200");
  });

  it("EmptyNotice renders the zinc notice and lets className override the tone", () => {
    const { unmount } = render(<EmptyNotice>ยังไม่มีรายการ</EmptyNotice>);
    expect(screen.getByText("ยังไม่มีรายการ").className).toContain("text-zinc-400");
    unmount();
    render(<EmptyNotice className="text-zinc-500">ยังไม่มีการตรวจ</EmptyNotice>);
    const overridden = screen.getByText("ยังไม่มีการตรวจ");
    expect(overridden.className).toContain("text-zinc-500");
    expect(overridden.className).not.toContain("text-zinc-400");
  });
});

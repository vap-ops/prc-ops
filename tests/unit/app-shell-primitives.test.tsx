// Component tests for the shared app-shell primitives (spec 17 items A–C):
// AppHeader (the hub-page header in its greeting / fixed-title /
// no-profile-link variants), StatusPill, and the ErrorNotice/EmptyNotice
// pair. These pin the markup contract the nine consuming pages rely on.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Spec 53: AppHeader now embeds RefreshButton (useRouter).
vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

import { AppHeader } from "@/components/features/chrome/app-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { StatusPill } from "@/components/features/common/status-pill";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";

describe("AppHeader", () => {
  it("renders the kicker and the greeting with the user's name", () => {
    render(<AppHeader kicker="หน้างาน" fullName="สมชาย" maxWidthClass={PAGE_MAX_W} />);
    expect(screen.getByText("หน้างาน")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("สวัสดี คุณสมชาย");
  });

  it("falls back to a bare greeting without a name", () => {
    render(<AppHeader kicker="หน้างาน" fullName={null} maxWidthClass={PAGE_MAX_W} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^สวัสดี$/);
  });

  it("renders a fixed title instead of the greeting when given", () => {
    // fullName is supplied too — the title must win over the greeting.
    render(
      <AppHeader
        kicker="ผู้จัดการโครงการ"
        title="รายงาน"
        fullName="สมชาย"
        maxWidthClass={PAGE_MAX_W}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/^รายงาน$/);
    expect(heading).not.toHaveTextContent("สวัสดี");
  });

  it("always shows the profile link (spec 18 normalization — no hide prop)", () => {
    render(<AppHeader kicker="คำขอซื้อ" fullName="สมชาย" maxWidthClass={PAGE_MAX_W} />);
    expect(screen.getByRole("link", { name: "โปรไฟล์" })).toHaveAttribute("href", "/profile");
  });

  it("is sticky chrome — pinned to the top while scrolling (spec 62)", () => {
    const { container } = render(
      <AppHeader kicker="หน้างาน" fullName="สมชาย" maxWidthClass={PAGE_MAX_W} />,
    );
    const header = container.querySelector("header");
    expect(header?.className).toContain("sticky");
    expect(header?.className).toContain("top-0");
  });

  it("carries the refresh button, NOT hidden in standalone (spec 53)", () => {
    // The installed PWA has no reload chrome — the refresh button is
    // the one header control that must stay visible there.
    render(<AppHeader kicker="หน้างาน" fullName="สมชาย" maxWidthClass={PAGE_MAX_W} />);
    const refresh = screen.getByRole("button", { name: "รีเฟรช" });
    expect(refresh.closest('[class*="display-mode:standalone"]')).toBeNull();
  });

  it("hides the logout button in standalone display-mode (spec 42)", () => {
    // Accidental logout in the installed PWA forces the expensive
    // re-login path; the header logout is CSS-hidden there. Deliberate
    // logout stays on /profile (reachable via the bottom tab).
    render(<AppHeader kicker="หน้างาน" fullName="สมชาย" maxWidthClass={PAGE_MAX_W} />);
    const logout = screen.getByRole("button", { name: "ออกจากระบบ" });
    const wrapper = logout.closest("form")?.parentElement;
    expect(wrapper?.className).toContain("[@media(display-mode:standalone)]:hidden");
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
  // Spec 20 sun palette: light insets with near-black ink.
  it("ErrorNotice renders the danger strip", () => {
    render(<ErrorNotice>โหลดไม่สำเร็จ</ErrorNotice>);
    const el = screen.getByText("โหลดไม่สำเร็จ");
    expect(el.className).toContain("border-danger");
    expect(el.className).toContain("text-danger-ink");
  });

  it("EmptyNotice renders the empty box and lets className extend the tone", () => {
    const { unmount } = render(<EmptyNotice>ยังไม่มีรายการ</EmptyNotice>);
    expect(screen.getByText("ยังไม่มีรายการ").className).toContain("text-ink-secondary");
    unmount();
    render(<EmptyNotice className="text-ink-muted">ยังไม่มีการตรวจ</EmptyNotice>);
    expect(screen.getByText("ยังไม่มีการตรวจ").className).toContain("text-ink-muted");
  });
});

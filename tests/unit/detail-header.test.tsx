// Unit tests for DetailHeader (spec 63) — the one sticky detail-header
// shell every detail page renders. Changing the design here changes
// every page by default (the operator's consolidation mandate).

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { DetailHeader } from "@/components/features/detail-header";

describe("DetailHeader", () => {
  it("renders the back chip with the page's href and aria-label", () => {
    render(
      <DetailHeader backHref="/sa/projects/p1" backLabel="กลับไปรายการงาน">
        <h1>x</h1>
      </DetailHeader>,
    );
    const back = screen.getByRole("link", { name: "กลับไปรายการงาน" });
    expect(back).toHaveAttribute("href", "/sa/projects/p1");
  });

  it("is sticky chrome (spec 62) with the refresh affordance (spec 53)", () => {
    const { container } = render(
      <DetailHeader backHref="/x" backLabel="ย้อนกลับ">
        <h1>x</h1>
      </DetailHeader>,
    );
    const header = container.querySelector("header");
    expect(header?.className).toContain("sticky");
    expect(header?.className).toContain("top-0");
    expect(screen.getByRole("button", { name: "รีเฟรช" })).toBeInTheDocument();
  });

  it("renders action chips next to the refresh button and the title block children", () => {
    render(
      <DetailHeader
        backHref="/x"
        backLabel="ย้อนกลับ"
        actions={<a href="/settings" aria-label="ตั้งค่าโครงการ" />}
      >
        <h1>ชื่อเรื่อง</h1>
      </DetailHeader>,
    );
    expect(screen.getByRole("link", { name: "ตั้งค่าโครงการ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ชื่อเรื่อง" })).toBeInTheDocument();
  });
});

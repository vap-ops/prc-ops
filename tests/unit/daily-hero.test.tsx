// Writing failing test first.
//
// Spec 192 U4b — the /sa daily-action hero. The SA's daily loop is log labour /
// add a photo; today they must first find the right WP card and tap its chip.
// The hero surfaces those two actions at the top: with a SINGLE active WP each is
// a direct link to that WP's labour / photo tab; with several it opens a quick
// "เลือกงาน" picker, then navigates to the chosen WP's tab. No new capture — it
// routes into the existing WP-detail deep-links (#wp-labor / #wp-photos).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { DailyHero, type DailyHeroWp } from "@/components/features/sa/daily-hero";

const one: DailyHeroWp[] = [{ id: "wp1", projectId: "p1", code: "WP-01", name: "งานเดินไฟ" }];
const many: DailyHeroWp[] = [...one, { id: "wp2", projectId: "p2", code: "WP-02", name: "งานปูน" }];

beforeEach(() => mockPush.mockReset());

describe("DailyHero (spec 192 U4b)", () => {
  it("with a single active WP, each action links straight to that WP's tab", () => {
    render(<DailyHero wps={one} />);
    expect(screen.getByRole("link", { name: /ลงเวลาวันนี้/ })).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/wp1#wp-labor",
    );
    expect(screen.getByRole("link", { name: /เพิ่มรูปวันนี้/ })).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/wp1#wp-photos",
    );
  });

  it("with several WPs, ลงเวลาวันนี้ opens a picker and choosing one navigates to its labour tab", () => {
    render(<DailyHero wps={many} />);
    // it's a button (picker), not a direct link, when there's more than one WP
    expect(screen.queryByRole("link", { name: /ลงเวลาวันนี้/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ลงเวลาวันนี้/ }));
    // the picker lists the WPs
    fireEvent.click(screen.getByRole("button", { name: /WP-02/ }));
    expect(mockPush).toHaveBeenCalledWith("/projects/p2/work-packages/wp2#wp-labor");
  });

  it("with several WPs, เพิ่มรูปวันนี้ routes the chosen WP to its photo tab", () => {
    render(<DailyHero wps={many} />);
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรูปวันนี้/ }));
    fireEvent.click(screen.getByRole("button", { name: /WP-01/ }));
    expect(mockPush).toHaveBeenCalledWith("/projects/p1/work-packages/wp1#wp-photos");
  });

  it("renders nothing when there are no active WPs", () => {
    const { container } = render(<DailyHero wps={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 277 P0 — the floating ถ่ายรูป FAB on the SA home. No new capture: it routes
// into the existing WP-detail photo deep-link (#wp-photos), recording /sa as the
// referrer so the back chip returns home. One active WP → a direct link; several →
// a เลือกงาน picker, then navigate to the chosen WP's photo tab.

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { CameraFab, type CameraFabWp } from "@/components/features/sa/camera-fab";

const one: CameraFabWp[] = [{ id: "wp1", projectId: "p1", code: "WP-01", name: "งานเดินไฟ" }];
const many: CameraFabWp[] = [...one, { id: "wp2", projectId: "p2", code: "WP-02", name: "งานปูน" }];

beforeEach(() => mockPush.mockReset());

describe("CameraFab (spec 277 P0)", () => {
  it("with a single active WP, links straight to its photo tab (referrer /sa)", () => {
    render(<CameraFab wps={one} />);
    expect(screen.getByRole("link", { name: /ถ่ายรูป/ })).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/wp1?from=%2Fsa#wp-photos",
    );
  });

  it("with several WPs, opens a picker and routes the chosen WP to its photo tab", () => {
    render(<CameraFab wps={many} />);
    expect(screen.queryByRole("link", { name: /ถ่ายรูป/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
    fireEvent.click(screen.getByRole("button", { name: /WP-02/ }));
    expect(mockPush).toHaveBeenCalledWith("/projects/p2/work-packages/wp2?from=%2Fsa#wp-photos");
  });

  it("renders nothing when there are no active WPs", () => {
    const { container } = render(<CameraFab wps={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

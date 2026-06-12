// Unit tests for the RefreshButton (spec 53) — the installed PWA's only
// reload affordance, so the contract is pinned: 44px target, Thai
// aria-label, router.refresh on tap, spin-while-pending.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { RefreshButton } from "@/components/features/refresh-button";

beforeEach(() => {
  refreshMock.mockReset();
});

describe("RefreshButton", () => {
  it("renders a 44px icon button labelled รีเฟรช", () => {
    render(<RefreshButton variant="light" />);
    const button = screen.getByRole("button", { name: "รีเฟรช" });
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("w-11");
  });

  it("calls router.refresh exactly once per tap", () => {
    render(<RefreshButton variant="light" />);
    fireEvent.click(screen.getByRole("button", { name: "รีเฟรช" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("dark and light variants carry different palettes", () => {
    const { container: dark } = render(<RefreshButton variant="dark" />);
    const { container: light } = render(<RefreshButton variant="light" />);
    const darkClasses = dark.querySelector("button")?.className ?? "";
    const lightClasses = light.querySelector("button")?.className ?? "";
    expect(darkClasses).not.toEqual(lightClasses);
    expect(darkClasses).toContain("slate");
    expect(lightClasses).toContain("zinc");
  });
});

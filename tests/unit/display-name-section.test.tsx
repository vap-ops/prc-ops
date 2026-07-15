// Spec 321 U5 — DisplayNameSection: enforces the operator's "detail/home pages
// are read-only, edit in a modal" rule (decision 6) for the display name on
// /profile and /settings/my-info. Shows the current name as a read row + an
// แก้ไข control that opens a BottomSheet hosting the existing DisplayNameForm.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/coming-soon/actions", () => ({ updateDisplayName: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { DisplayNameSection } from "@/components/features/profile/display-name-section";

describe("DisplayNameSection", () => {
  it("shows the current display name as a read row", () => {
    render(<DisplayNameSection initialName="สมชาย ใจดี" />);
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
  });

  it("shows a placeholder when no display name is set", () => {
    render(<DisplayNameSection initialName="" />);
    expect(screen.getByText("ยังไม่ได้ตั้งชื่อที่แสดง")).toBeInTheDocument();
  });

  it("does not render the edit form inline (only opens it in a sheet)", () => {
    render(<DisplayNameSection initialName="สมชาย ใจดี" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens the sheet with the name form when แก้ไข is tapped", () => {
    render(<DisplayNameSection initialName="สมชาย ใจดี" />);
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("สมชาย ใจดี");
  });
});

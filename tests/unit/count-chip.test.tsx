// Unit tests for the CountChip primitive (spec 54) — the mockup's amber
// "1 คำขอซื้อรออนุมัติ ›" pill.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CountChip } from "@/components/features/common/count-chip";

describe("CountChip", () => {
  it("renders the count disc, the label, and the link target", () => {
    render(<CountChip count={1} label="คำขอซื้อรออนุมัติ" href="#wp-requests" />);
    const link = screen.getByRole("link", { name: /1.*คำขอซื้อรออนุมัติ/ });
    expect(link).toHaveAttribute("href", "#wp-requests");
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders nothing at count 0 — no empty chips", () => {
    const { container } = render(<CountChip count={0} label="คำขอซื้อรออนุมัติ" href="#x" />);
    expect(container.firstChild).toBeNull();
  });
});

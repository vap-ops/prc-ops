// Spec 98 — the shared เร็วๆนี้ (coming-soon) pill. Token-only classes so a
// theme change stays in globals.css; no raw Tailwind palette (design-doctrine).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComingSoonBadge } from "@/components/features/chrome/coming-soon-badge";

describe("ComingSoonBadge", () => {
  it("renders the เร็วๆนี้ label", () => {
    render(<ComingSoonBadge />);
    expect(screen.getByText("เร็วๆนี้")).toBeInTheDocument();
  });

  it("uses token classes, never a raw palette literal", () => {
    render(<ComingSoonBadge />);
    const badge = screen.getByText("เร็วๆนี้");
    expect(badge.className).toContain("bg-sunk");
    expect(badge.className).toContain("text-ink-secondary");
    expect(badge.className).not.toMatch(
      /\b(?:bg|text|border|ring)-(?:zinc|gray|slate|green|blue|amber|red)-\d/,
    );
  });
});

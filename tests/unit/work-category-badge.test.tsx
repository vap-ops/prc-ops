// Writing failing test first.
//
// Spec 229 (ADR 0066 / S8) — the WP-detail work-category badge. It surfaces the
// หมวดงาน the work package is bound to (a project category, spec 207/226), or a
// nudge when the WP is still uncategorised. Pure display.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkCategoryBadge } from "@/components/features/work-packages/work-category-badge";

describe("WorkCategoryBadge (spec 229 / S8)", () => {
  it("shows the WP's bound work-category name", () => {
    render(<WorkCategoryBadge name="งานโครงสร้าง" />);
    expect(screen.getByText(/งานโครงสร้าง/)).toBeInTheDocument();
  });

  it("shows the uncategorised nudge when the WP has no work-category", () => {
    render(<WorkCategoryBadge name={null} />);
    expect(screen.getByText("ยังไม่ระบุหมวดงาน")).toBeInTheDocument();
  });

  // Spec 277 U1b — when the WP's project-category reconciles to a GLOBAL
  // work-category, the badge shows the letter·color·icon CategoryChip.
  it("renders the category chip (letter + name) when a work-category code is given", () => {
    render(<WorkCategoryBadge name="งานระบบไฟฟ้า" code="W05" />);
    expect(screen.getByText("E")).toBeInTheDocument();
    expect(screen.getByText("งานระบบไฟฟ้า")).toBeInTheDocument();
  });

  it("falls back to the plain name pill when there is no work-category code", () => {
    render(<WorkCategoryBadge name="เฉพาะโปรเจกต์" />);
    expect(screen.getByText(/เฉพาะโปรเจกต์/)).toBeInTheDocument();
    expect(screen.queryByText("E")).toBeNull();
  });
});

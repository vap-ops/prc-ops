// Writing failing test first.
//
// Spec 277 U1 — CategoryChip: the single render point for a work-category's
// letter + color + icon, sibling of StatusPill. Renders null when the code is
// missing/unknown (the caller shows its own "uncategorised" state).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryChip } from "@/components/features/work-packages/category-chip";

describe("CategoryChip (spec 277 U1)", () => {
  it("shows the category letter and label", () => {
    const { container } = render(<CategoryChip code="W05" label="ไฟฟ้า" />);
    expect(screen.getByText("E")).toBeInTheDocument();
    expect(screen.getByText("ไฟฟ้า")).toBeInTheDocument();
    // the colored tile carries the category token class
    expect(container.querySelector(".bg-cat-w05")).not.toBeNull();
  });

  it("resolves a subsection code to its parent letter", () => {
    render(<CategoryChip code="W0203" label="เสาเข็ม" />);
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("renders the letter tile even without a label (icon-only chip)", () => {
    render(<CategoryChip code="W02" />);
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("exposes an accessible name when there is no visible label", () => {
    render(<CategoryChip code="W02" />);
    // icon-only: the chip must still be nameable (label ?? code)
    expect(screen.getByLabelText("W02")).toBeInTheDocument();
  });

  it("renders nothing for an uncategorised or unknown code", () => {
    const { container: a } = render(<CategoryChip code={null} label="ไฟฟ้า" />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<CategoryChip code="Z99" />);
    expect(b).toBeEmptyDOMElement();
  });
});

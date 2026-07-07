// Spec 270 U4 — the งานย่อย detail's parent breadcrumb (WP-05 › WP-05-03):
// the parent งาน is a link to its oversight page; the current code is text.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WpParentCrumb } from "@/components/features/work-packages/wp-parent-crumb";

describe("WpParentCrumb", () => {
  it("links the parent งาน and shows the current code after ›", () => {
    render(
      <WpParentCrumb
        projectId="proj-1"
        parent={{ id: "g-1", code: "WP-05", name: "งานหลังคา" }}
        currentCode="WP-05-03"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/projects/proj-1/work-packages/g-1");
    expect(link).toHaveTextContent("WP-05");
    expect(link).toHaveAccessibleName(/งานหลังคา/); // the งาน name reachable for SR users
    expect(screen.getByText(/›/)).toBeInTheDocument();
    expect(screen.getByText("WP-05-03")).toBeInTheDocument();
  });
});

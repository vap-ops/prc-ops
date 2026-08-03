// Spec 389 U5 — the ตัวอย่างงาน strip (presentational): starred reference
// photos of this WP's work-type across ALL projects, each with its
// source-project chip and the PD's note; the section's whole contract is that
// it renders NOTHING when there is nothing to show (parent handles that — this
// component asserts the rendering of a non-empty set).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReferenceExamples } from "@/components/features/wp-catalog/reference-examples";

const rows = [
  {
    photoLogId: "p1",
    thumbUrl: "https://signed/p1-thumb.jpg",
    fullUrl: "https://signed/p1-full.jpg",
    projectName: "TFM โพธิ์ทอง ลพบุรี",
    note: "มุมนี้ถูกต้อง",
  },
  {
    photoLogId: "p2",
    thumbUrl: "https://signed/p2-thumb.jpg",
    fullUrl: "https://signed/p2-full.jpg",
    projectName: "TFM นายาว เพชรบูรณ์",
    note: null,
  },
];

describe("ReferenceExamples", () => {
  it("renders the section heading, one tile per row, and the source-project chip", () => {
    const { container } = render(<ReferenceExamples rows={rows} />);
    expect(screen.getByText("ตัวอย่างงาน")).toBeInTheDocument();
    // ZoomablePhoto renders alt="" imgs (decorative in the a11y tree) — count tags
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByText("TFM โพธิ์ทอง ลพบุรี")).toBeInTheDocument();
    expect(screen.getByText("TFM นายาว เพชรบูรณ์")).toBeInTheDocument();
  });

  it("shows the PD's note when present and no note row otherwise", () => {
    render(<ReferenceExamples rows={rows} />);
    expect(screen.getByText("มุมนี้ถูกต้อง")).toBeInTheDocument();
  });
});

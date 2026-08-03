// Spec 389 U5 — the ตัวอย่างงาน strip (presentational): starred reference
// photos of this WP's work-type across ALL projects, each with its
// source-project chip and the PD's note; the section's whole contract is that
// it renders NOTHING when there is nothing to show (parent handles that — this
// component asserts the rendering of a non-empty set).

import { readFileSync } from "node:fs";
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
    const { container } = render(<ReferenceExamples rows={rows} />);
    expect(screen.getByText("มุมนี้ถูกต้อง")).toBeInTheDocument();
    // the second tile (note: null) renders only its project chip line
    const tiles = container.querySelectorAll("li");
    expect(tiles[1]?.querySelectorAll("span.block, span.line-clamp-2")).toHaveLength(1);
  });

  it("renders NOTHING for an empty row set", () => {
    const { container } = render(<ReferenceExamples rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("does NOT wire the markup layer — reference tiles are read-only across projects", () => {
    // photoId turns spec-51 markup ON; a cross-project viewer's markup save can
    // only 403 (source-project-scoped RLS), so the prop must stay absent.
    const src = readFileSync(
      "src/components/features/wp-catalog/reference-examples.tsx",
      "utf8",
    ).replace(/\/\/[^\n]*/g, "");
    expect(src).not.toContain("photoId={");
    expect(src).not.toContain("groupPhotoIds");
  });
});

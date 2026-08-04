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
    // Spec 391 D7 — a deliberate PD pick, mixed with an automatic one below.
    // The mixed set is the NORMAL case since 391, so it is what the fixture
    // models.
    starred: true,
  },
  {
    photoLogId: "p2",
    thumbUrl: "https://signed/p2-thumb.jpg",
    fullUrl: "https://signed/p2-full.jpg",
    projectName: "TFM นายาว เพชรบูรณ์",
    note: null,
    starred: false,
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

// Writing failing test first.
//
// Spec 391 D7/D8 — the strip is no longer "what a PD starred". It fills itself,
// so the subtitle must not credit a human for a machine's pick (the same lie D1
// refuses to write into the table by backfilling stars), and the ⭐ has to mark
// the ones a PD really did choose — otherwise starring a photo the derived arm
// was ALREADY showing is an action with no visible result.
describe("ReferenceExamples — automatic vs curated (spec 391)", () => {
  const mixed = rows; // one starred, one derived — the normal case since 391
  const allStarred = rows.map((r) => ({ ...r, starred: true }));

  it("marks ONLY the starred tile", () => {
    render(<ReferenceExamples rows={mixed} />);
    const marks = screen.getAllByText("ผู้อำนวยการโครงการเลือกรูปนี้เป็นตัวอย่าง");
    // one sr-only label per starred tile — 1 of the 2 rows
    expect(marks).toHaveLength(1);
  });

  it("does not claim the PD chose them when the set is mixed", () => {
    render(<ReferenceExamples rows={mixed} />);
    expect(screen.getByText(/ตัวอย่างงานประเภทเดียวกันที่ทำเสร็จแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText(/^รูปที่ผู้อำนวยการโครงการปักดาวไว้/)).not.toBeInTheDocument();
  });

  it("but DOES credit the PD when every tile really is theirs", () => {
    // The honest inverse: understating human curation would be its own small
    // lie, and it is what makes the mixed-case wording meaningful.
    render(<ReferenceExamples rows={allStarred} />);
    expect(screen.getByText(/^รูปที่ผู้อำนวยการโครงการปักดาวไว้/)).toBeInTheDocument();
  });
});

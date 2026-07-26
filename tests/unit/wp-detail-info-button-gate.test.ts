// Writing failing test first.
//
// Spec 363 U1 (D2): the WP-detail header renders WorkPackageInfoButton
// UNCONDITIONALLY. Before this unit it was gated on
// `assignedContractor || wp.description`, which was harmless while the sheet only
// held contractor + description — but the sheet now also holds หมายเหตุ, so that
// gate would leave a bare WP with no route to its notes at all.
//
// Why a SOURCE assertion rather than RTL: the gate lives in a Server Component's
// JSX (`actions={…}` on DetailHeader), which vitest cannot render. The component
// test beside this one (work-package-info-button.test.tsx) proves the sheet's
// CONTENTS; it cannot see the page's gate — re-adding the gate leaves every one of
// its cases green, which is exactly how this hole was found.
//
// Comments are stripped before scanning: a comment that QUOTES the retired
// expression would otherwise trip the absence pin (documenting the hazard must not
// become the hazard).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = join(
  process.cwd(),
  "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx",
);

function sourceWithoutComments(): string {
  return readFileSync(PAGE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("WP detail header — the ⓘ is unconditional (spec 363 U1)", () => {
  it("does not gate WorkPackageInfoButton on having a contractor or a description", () => {
    expect(sourceWithoutComments()).not.toContain("assignedContractor || wp.description");
  });

  it("passes the notes and the edit capability into the sheet", () => {
    const src = sourceWithoutComments();
    expect(src).toContain("notes={wp.notes}");
    expect(src).toContain("canEditNotes={!readOnly}");
  });

  it("renders exactly one WorkPackageInfoButton", () => {
    const src = sourceWithoutComments();
    expect(src.split("<WorkPackageInfoButton").length - 1).toBe(1);
  });

  it("keeps the notes editor out of the ข้อมูล tab", () => {
    // U1 moved หมายเหตุ into the sheet; the tab keeps ประวัติการตรวจ only.
    // (U2 retires the tab entirely — update this pin then, do not delete it.)
    expect(sourceWithoutComments()).not.toContain("<WorkPackageNotes");
  });
});

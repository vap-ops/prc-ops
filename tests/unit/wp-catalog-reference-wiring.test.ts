// Spec 389 U5 — source pins for the two Server Components vitest cannot
// render (comments stripped first; exact occurrence counts, never toContain —
// the import line alone satisfies a substring).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const count = (src: string, needle: string) => src.split(needle).length - 1;

const reviewPage = strip(
  readFileSync("src/app/review/work-packages/[workPackageId]/page.tsx", "utf8"),
);
const wpDetailPage = strip(
  readFileSync("src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx", "utf8"),
);

describe("review page — starring wiring", () => {
  it("gates starring on the exact PD tier AND a mapped WP", () => {
    expect(count(reviewPage, '"project_director"')).toBe(1);
    // super_admin appears once in the canStar gate (labor escalation comments stripped)
    expect(count(reviewPage, 'ctx.role === "super_admin"')).toBe(1);
    expect(count(reviewPage, "wp.wp_catalog_item_id !== null")).toBe(1);
  });

  it("passes starring to all three PhaseGallery mounts", () => {
    expect(count(reviewPage, "starring={starring}")).toBe(3);
    // the ternary itself — deleting the canStar gate must red here, not just lint
    // Spec 391 U2: 3 → 4. The hidden-photo read is a SECOND query behind the
    // SAME gate, so a non-PD triggers neither. Counting is what caught the
    // change; the two structural assertions below are what make the count mean
    // something rather than being a number someone bumps.
    expect(count(reviewPage, "canStar")).toBe(4);
    expect(count(reviewPage, "starring = canStar")).toBe(1);
  });

  // Writing failing test first.
  //
  // Spec 391 U2 — the hidden set is read from its own table and threaded on the
  // same prop. Both halves matter: reading it UNGATED would fire an extra query
  // for every reviewer, and threading only the starred half would leave the hide
  // control rendering "not hidden" forever with no test noticing.
  it("reads the hidden set behind the same gate and threads it", () => {
    expect(count(reviewPage, "wp_catalog_hidden_reference_photos")).toBe(1);
    expect(count(reviewPage, "if (canStar && allPhotos.length > 0)")).toBe(2);
    expect(count(reviewPage, "hiddenPhotoIds")).toBe(3);
  });
});

describe("WP detail page — reference section wiring", () => {
  it("renders the ตัวอย่างงาน section in BOTH photo branches (read-only and capture)", () => {
    expect(count(wpDetailPage, "<ReferencePhotoSection")).toBe(2);
    expect(count(wpDetailPage, "wpCatalogItemId={wp.wp_catalog_item_id}")).toBe(2);
  });
});

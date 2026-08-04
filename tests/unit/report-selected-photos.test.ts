// Spec 394 U3 — the `เฉพาะที่เลือก` report source.
//
// The pure half of the branch: given a project's selection rows and the WPs in
// code order, produce the per-WP photo lists the PDF builder consumes. Kept
// pure because the ORDER is the whole point of D6 and it must be assertable
// without a database.

import { describe, expect, it } from "vitest";

import { buildSelectedPhotoOrder } from "@/lib/reports/selected-photos";

const WPS = [
  { id: "wp-a", code: "S-01" },
  { id: "wp-b", code: "S-02" },
  { id: "wp-c", code: "S-03" },
];

describe("buildSelectedPhotoOrder (spec 394 D6)", () => {
  it("orders photos by position WITHIN each work package", () => {
    const out = buildSelectedPhotoOrder(WPS, [
      { work_package_id: "wp-a", photo_log_id: "p3", position: 3 },
      { work_package_id: "wp-a", photo_log_id: "p1", position: 1 },
      { work_package_id: "wp-a", photo_log_id: "p2", position: 2 },
    ]);
    expect(out).toEqual([{ workPackageId: "wp-a", photoIds: ["p1", "p2", "p3"] }]);
  });

  it("keeps work packages in the CODE order it was given, not selection order", () => {
    // wp-c's photo was selected first; sections must still read S-02 then S-03
    // because spec 389's codes are build order — the report walks the project
    // chronologically and D6 deliberately does not re-order sections.
    const out = buildSelectedPhotoOrder(WPS, [
      { work_package_id: "wp-c", photo_log_id: "c1", position: 1 },
      { work_package_id: "wp-b", photo_log_id: "b1", position: 1 },
    ]);
    expect(out.map((s) => s.workPackageId)).toEqual(["wp-b", "wp-c"]);
  });

  it("omits work packages with nothing selected — no empty sections", () => {
    const out = buildSelectedPhotoOrder(WPS, [
      { work_package_id: "wp-b", photo_log_id: "b1", position: 1 },
    ]);
    expect(out).toEqual([{ workPackageId: "wp-b", photoIds: ["b1"] }]);
  });

  it("ignores a selection whose work package is not in the report's scope", () => {
    // scope=complete narrows the WP list; a selection on an excluded WP must
    // not resurrect that section.
    const out = buildSelectedPhotoOrder(
      [{ id: "wp-a", code: "S-01" }],
      [
        { work_package_id: "wp-a", photo_log_id: "a1", position: 1 },
        { work_package_id: "wp-z", photo_log_id: "z1", position: 1 },
      ],
    );
    expect(out).toEqual([{ workPackageId: "wp-a", photoIds: ["a1"] }]);
  });

  it("tolerates a gap in positions — a cascade cannot renumber siblings (§7)", () => {
    // `on delete cascade` removes a selection and leaves a hole; reads sort by
    // position and must not require density.
    const out = buildSelectedPhotoOrder(WPS, [
      { work_package_id: "wp-a", photo_log_id: "p1", position: 1 },
      { work_package_id: "wp-a", photo_log_id: "p9", position: 9 },
    ]);
    expect(out).toEqual([{ workPackageId: "wp-a", photoIds: ["p1", "p9"] }]);
  });

  it("returns nothing at all when the project has no selections", () => {
    expect(buildSelectedPhotoOrder(WPS, [])).toEqual([]);
  });
});

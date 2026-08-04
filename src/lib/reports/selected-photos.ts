// Spec 394 U3 — the pure half of the `เฉพาะที่เลือก` report source.
//
// Kept pure and separate from run-report-job because ORDER is the whole point
// of D6: photos read in the sequence PD arranged them, within a work package.
// A database round-trip cannot assert that; this can.

export interface SelectedPhotoRow {
  work_package_id: string;
  photo_log_id: string;
  position: number;
}

export interface SelectedPhotoSection {
  workPackageId: string;
  photoIds: string[];
}

/**
 * `workPackages` arrives in the report's own order (code order — spec 389's
 * codes are build order, so the report walks the project chronologically, and
 * D6 deliberately does NOT re-order sections). Sections with nothing selected
 * are omitted, so the caller never emits an empty heading.
 *
 * Positions are sorted, not assumed dense: `on delete cascade` removes a
 * selection and cannot renumber its siblings (§7), so a gap is a legal state
 * and correctness must not depend on density.
 */
export function buildSelectedPhotoOrder(
  workPackages: ReadonlyArray<{ id: string; code: string }>,
  rows: ReadonlyArray<SelectedPhotoRow>,
): SelectedPhotoSection[] {
  const byWorkPackage = new Map<string, SelectedPhotoRow[]>();
  for (const row of rows) {
    const bucket = byWorkPackage.get(row.work_package_id);
    if (bucket) bucket.push(row);
    else byWorkPackage.set(row.work_package_id, [row]);
  }

  const sections: SelectedPhotoSection[] = [];
  for (const wp of workPackages) {
    // A selection on a WP outside this report's scope (scope=complete narrows
    // the list) must not resurrect that section.
    const picked = byWorkPackage.get(wp.id);
    if (!picked || picked.length === 0) continue;
    sections.push({
      workPackageId: wp.id,
      photoIds: [...picked].sort((a, b) => a.position - b.position).map((r) => r.photo_log_id),
    });
  }
  return sections;
}

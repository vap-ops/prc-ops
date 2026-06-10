// Pure grouping for the deliverable-grouped WP list (spec 11).
//
// No I/O, no React — callers (the work-package-list client component
// today; potentially the spec 04 Phase 3 PDF layout later) pass WPs in
// their display order plus the project's deliverables, and get back
// render-ready groups. Group order: deliverable.sortOrder asc, ties by
// code asc. WPs whose deliverableId is null or references an id not in
// the deliverables list land in a final `deliverable: null` ("Ungrouped")
// group — mirroring the bucket rule spec 04 Phase 3 defines for PDFs.
// Empty groups never appear; WP input order is preserved within a group.

export interface GroupDeliverable {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

export interface DeliverableGroup<T> {
  deliverable: GroupDeliverable | null;
  workPackages: T[];
}

export function groupWorkPackagesByDeliverable<T extends { deliverableId: string | null }>(
  workPackages: ReadonlyArray<T>,
  deliverables: ReadonlyArray<GroupDeliverable>,
): Array<DeliverableGroup<T>> {
  const byId = new Map(deliverables.map((d) => [d.id, d]));
  const buckets = new Map<string | null, T[]>();

  for (const wp of workPackages) {
    const key = wp.deliverableId !== null && byId.has(wp.deliverableId) ? wp.deliverableId : null;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(wp);
    } else {
      buckets.set(key, [wp]);
    }
  }

  const ordered = [...deliverables].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );

  const groups: Array<DeliverableGroup<T>> = [];
  for (const d of ordered) {
    const wps = buckets.get(d.id);
    if (wps && wps.length > 0) {
      groups.push({ deliverable: d, workPackages: wps });
    }
  }
  const ungrouped = buckets.get(null);
  if (ungrouped && ungrouped.length > 0) {
    groups.push({ deliverable: null, workPackages: ungrouped });
  }
  return groups;
}

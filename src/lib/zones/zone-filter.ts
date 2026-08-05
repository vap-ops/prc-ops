// Spec 392 U3a — narrowing the project work-list to one zone.
//
// The list is a two-level roster (spec 270): งาน groups head sections, งานย่อย
// leaves live inside them, and only leaves carry a `zone_id`. So the filter is
// deliberately ASYMMETRIC — a straight `wp.zoneId === z` would delete every
// group row and collapse the งาน lens to an empty page while the matching
// leaves still exist. A group survives exactly as long as one of its children
// does, which is also what makes the section headers' own counts honest.
//
// Pure and DOM-free: the list component holds the selection, this decides the
// rows.

/** The minimal shape the filter reads — WorkPackageListItem satisfies it. */
export interface ZoneFilterable {
  id: string;
  isGroup: boolean;
  parentId: string | null;
  zoneId: string | null;
}

/**
 * The "not placed in any zone yet" selection. A distinct sentinel rather than
 * `null`, because `null` already means "no filter at all" — and the difference
 * between showing every งาน and showing only the unplaced ones is the whole
 * point of the chip (spec 392 §8's fill rate is exactly this bucket's size).
 */
export const UNZONED = "__unzoned__";

export type ZoneSelection = string | typeof UNZONED | null;

export function filterByZone<T extends ZoneFilterable>(
  workPackages: ReadonlyArray<T>,
  selection: ZoneSelection,
): T[] {
  if (selection === null) return [...workPackages];

  const matches = (wp: T) => (selection === UNZONED ? wp.zoneId === null : wp.zoneId === selection);

  const leaves = workPackages.filter((wp) => !wp.isGroup && matches(wp));
  const survivingParents = new Set(
    leaves.map((leaf) => leaf.parentId).filter((id): id is string => id !== null),
  );

  // Input order is preserved: the lenses each apply their own sort, and a
  // filter that reshuffled the roster would silently change what they produce.
  return workPackages.filter((wp) =>
    wp.isGroup ? survivingParents.has(wp.id) : !wp.isGroup && matches(wp),
  );
}

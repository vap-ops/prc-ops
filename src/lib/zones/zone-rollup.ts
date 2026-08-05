// Spec 392 U3a — the zone × หมวดงาน rollup: the surface that answers the
// operator's stated requirement, "track work per zone".
//
// Zone is an AXIS, not a parent (U1): a work package carries exactly one
// work-category while a zone spans several trades, so the two are independent
// dimensions and the only honest way to read them together is a grid. Rows are
// zones (in the zone list's own order, so the two surfaces can never disagree),
// columns are the project's work-categories, cells are leaf counts.
//
// Two rules carry the arithmetic, and both exist because their absence produces
// a number that looks right:
//
//  • ONLY LEAVES COUNT. A งาน (`is_group`) row is a grouping entity — the DB
//    rejects all work on it — so counting it adds its children a second time.
//  • THE REMAINDER IS REPORTED. `work_packages.zone_id` is nullable and stays
//    that way (a WP spanning the whole site never gets a zone), so a grid of
//    only the zoned work reads as full coverage while almost none of the
//    project is mapped. `unzoned` is that remainder, and it is the fill rate
//    spec 392 §8 accepts on.
//
// Pure and DOM-free: the project page renders it on the server.

import type { WorkPackageStatus } from "@/lib/db/enums";
import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";
import { buildZoneList, type ZoneRowInput } from "./zone-list";

/** The minimal work-package shape the grid reads. */
export interface RollupWorkPackage {
  zoneId: string | null;
  categoryId: string | null;
  status: WorkPackageStatus;
  isGroup: boolean;
}

/** A project work-category (หมวดงาน) as the project page already loads it. */
export interface RollupCategory {
  id: string;
  /** The reconciled global work-category code (W0x), when the project category maps to one. */
  code: string | null;
  name: string;
  sortOrder: number;
}

export interface RollupColumn {
  /** null = the trailing "uncategorised" column. */
  id: string | null;
  code: string | null;
  name: string | null;
}

export interface RollupRow {
  /** null = the unzoned remainder row. */
  zoneId: string | null;
  code: string | null;
  name: string | null;
  /** 0 for a top-level zone; a child indents under its parent, as in the list. */
  depth: number;
  /** One count per entry of `columns`, same index. */
  cells: number[];
  total: number;
  complete: number;
  /** complete/total as a whole percent; 0 for an empty zone (never NaN). */
  percent: number;
}

export interface ZoneRollup {
  columns: RollupColumn[];
  rows: RollupRow[];
  /** The leaves carrying no zone; null when every leaf is placed (or there are no zones). */
  unzoned: RollupRow | null;
}

const EMPTY: ZoneRollup = { columns: [], rows: [], unzoned: null };

export function buildZoneRollup(args: {
  zones: ReadonlyArray<ZoneRowInput>;
  categories: ReadonlyArray<RollupCategory>;
  workPackages: ReadonlyArray<RollupWorkPackage>;
}): ZoneRollup {
  const { zones, categories, workPackages } = args;
  // No zones drawn yet is the live state of every project today — the grid has
  // nothing to say, and an empty frame would only take space on a phone.
  if (zones.length === 0) return EMPTY;

  const leaves = workPackages.filter((wp) => !wp.isGroup);
  const zoneIds = new Set(zones.map((z) => z.id));

  // A category the WP points at but the project list does not carry (deleted,
  // or invisible to this reader) must not swallow the work package: it falls
  // into the same trailing bucket as an unset category.
  const knownCategoryIds = new Set(categories.map((c) => c.id));
  const bucketOf = (wp: RollupWorkPackage): string | null =>
    wp.categoryId !== null && knownCategoryIds.has(wp.categoryId) ? wp.categoryId : null;

  // A zone_id pointing at a zone this reader cannot see is not "unzoned" — it
  // is work whose placement is hidden, and reporting it as unplaced would
  // overstate the remainder. Such rows leave the grid entirely, and they must
  // leave before the columns are chosen: derived from every leaf, a category
  // whose only work sits in hidden zones would survive as an all-zero column.
  const counted = leaves.filter((leaf) => leaf.zoneId === null || zoneIds.has(leaf.zoneId));

  // Columns are the buckets that actually carry counted work, in the project's
  // own category order with the uncategorised bucket last. A phone cannot
  // scroll twenty empty columns, and an all-zero column states nothing.
  const usedBuckets = new Set(counted.map(bucketOf));
  const columns: RollupColumn[] = [
    ...[...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((c) => usedBuckets.has(c.id))
      .map((c) => ({ id: c.id, code: c.code, name: c.name })),
    ...(usedBuckets.has(null) ? [{ id: null, code: null, name: null }] : []),
  ];
  const columnIndex = new Map<string | null, number>(columns.map((c, i) => [c.id, i]));

  const emptyCells = () => new Array<number>(columns.length).fill(0);
  const byZone = new Map<string | null, { cells: number[]; statuses: WorkPackageStatus[] }>();
  const bucketFor = (zoneId: string | null) => {
    const existing = byZone.get(zoneId);
    if (existing) return existing;
    const created = { cells: emptyCells(), statuses: [] as WorkPackageStatus[] };
    byZone.set(zoneId, created);
    return created;
  };

  for (const leaf of counted) {
    const target = bucketFor(leaf.zoneId);
    const col = columnIndex.get(bucketOf(leaf));
    if (col !== undefined) target.cells[col] = (target.cells[col] ?? 0) + 1;
    target.statuses.push(leaf.status);
  }

  const toRow = (
    zoneId: string | null,
    code: string | null,
    name: string | null,
    depth: number,
  ): RollupRow => {
    const bucket = byZone.get(zoneId);
    const progress = deriveDeliverableProgress(bucket?.statuses ?? []);
    return {
      zoneId,
      code,
      name,
      depth,
      cells: bucket?.cells ?? emptyCells(),
      total: progress.totalCount,
      complete: progress.completeCount,
      percent: progress.percent,
    };
  };

  // buildZoneList owns the ordering and the indent for BOTH surfaces — reusing
  // it is what stops the grid and the list from disagreeing about which zone
  // sits where, and it carries the cycle/orphan handling for free.
  const rows = buildZoneList(zones, {}).map((z) => toRow(z.id, z.code, z.name, z.depth));
  const unzoned = byZone.has(null) ? toRow(null, null, null, 0) : null;

  return { columns, rows, unzoned };
}

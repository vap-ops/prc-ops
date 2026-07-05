// Spec 270 U3 — pure grouped-roster view-model (no I/O, no React). A project
// ADOPTS the two-level งาน/งานย่อย model the moment it has any is_group row
// (the grouping import creates them); until then the roster renders flat,
// exactly as before. Sections order by group code, children by child code —
// natural-numeric compare so WP-2 < WP-10 regardless of zero-padding.
// A group's completion counts derive from its children here; its STATUS pill
// is the group row's own `status` (the DB rollup trigger is the truth source).

import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";
import type { WorkPackageStatus } from "@/lib/db/enums";

export interface GroupRosterItem {
  id: string;
  code: string;
  isGroup: boolean;
  parentId: string | null;
  status: WorkPackageStatus;
}

export interface GroupSection<T> {
  group: T;
  /** งานย่อย inside, sorted by hierarchical code. */
  children: T[];
  completeCount: number;
  totalCount: number;
  percent: number;
}

export interface GroupedRoster<T> {
  /** true = the project has งาน rows (two-level model adopted). */
  adopted: boolean;
  /** งาน sections sorted by code (empty for a legacy project). */
  sections: Array<GroupSection<T>>;
  /** Leaves with no (known) parent — legacy remnants inside an adopted project. */
  ungrouped: T[];
  /** Every non-group row, input order — the feed for the other lenses. */
  leaves: T[];
}

const byCode = (a: { code: string }, b: { code: string }) =>
  a.code.localeCompare(b.code, "en", { numeric: true });

export function buildGroupedRoster<T extends GroupRosterItem>(
  workPackages: ReadonlyArray<T>,
): GroupedRoster<T> {
  const groups = workPackages.filter((wp) => wp.isGroup);
  const leaves = workPackages.filter((wp) => !wp.isGroup);
  if (groups.length === 0) {
    return { adopted: false, sections: [], ungrouped: [...leaves], leaves: [...leaves] };
  }

  const groupIds = new Set(groups.map((g) => g.id));
  const childrenByParent = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const leaf of leaves) {
    if (leaf.parentId !== null && groupIds.has(leaf.parentId)) {
      const bucket = childrenByParent.get(leaf.parentId);
      if (bucket) bucket.push(leaf);
      else childrenByParent.set(leaf.parentId, [leaf]);
    } else {
      ungrouped.push(leaf);
    }
  }

  const sections = [...groups].sort(byCode).map((group) => {
    const children = (childrenByParent.get(group.id) ?? []).sort(byCode);
    const progress = deriveDeliverableProgress(children.map((c) => c.status));
    return {
      group,
      children,
      completeCount: progress.completeCount,
      totalCount: progress.totalCount,
      percent: progress.percent,
    };
  });

  return { adopted: true, sections, ungrouped, leaves: [...leaves] };
}

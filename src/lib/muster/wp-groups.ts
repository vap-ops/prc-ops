// Spec 306 grain-coverage — the muster WP picker types + the pure grouping fold.
// Kept OUT of load-muster.ts (which is `server-only`) so the client cockpit can
// import groupMusterWps as a VALUE — a value import of a server-only module into a
// "use client" component fails the build.
//
// The picker offers LEAF (งานย่อย) WPs (the close-day derive binds labor_logs to
// leaves; the DB forbids binding to a group งาน). Each leaf carries its parent งาน's
// identity so the picker can group by it; null for a standalone leaf main-WP
// (parent_id IS NULL, is_group false).
export interface MusterWp {
  id: string;
  code: string;
  name: string;
  parentId?: string | null;
  parentCode?: string | null;
  parentName?: string | null;
}

// A collapsible picker group: one parent งาน (or the null-parent standalone bucket)
// with its selectable leaf WPs.
export interface MusterWpGroup {
  parentId: string | null;
  parentCode: string | null;
  parentName: string | null;
  children: MusterWp[];
}

// Fold the flat leaf list into one group per parent งาน (header = parent code + name),
// plus a trailing null-parent bucket for standalone leaf main-WPs. Named groups sort
// by parent code; children sort by their own code. Pure — the cockpit renders it.
export function groupMusterWps(wps: MusterWp[]): MusterWpGroup[] {
  const byParent = new Map<string | null, MusterWpGroup>();
  for (const wp of wps) {
    const key = wp.parentId ?? null;
    let group = byParent.get(key);
    if (!group) {
      group = {
        parentId: key,
        parentCode: key === null ? null : (wp.parentCode ?? null),
        parentName: key === null ? null : (wp.parentName ?? null),
        children: [],
      };
      byParent.set(key, group);
    }
    group.children.push(wp);
  }
  for (const group of byParent.values()) {
    group.children.sort((a, b) => a.code.localeCompare(b.code));
  }
  return [...byParent.values()].sort((a, b) => {
    // Standalone (null-parent) bucket always last.
    if (a.parentId === null) return 1;
    if (b.parentId === null) return -1;
    return (a.parentCode ?? "").localeCompare(b.parentCode ?? "");
  });
}

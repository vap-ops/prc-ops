// Spec 392 U2a — the zone list, which is the ACCESSIBLE path to everything the
// canvas does. A canvas is opaque to a screen reader and to a keyboard, so the
// list is not a summary of the map: it is the other way of operating it. That
// makes its ordering and its counts product behaviour.
//
// Pure and DOM-free on purpose — the page renders it on the server and U2b's
// editor island reuses the same order, so the two can never disagree.

import type { ZoneShape } from "./validate-zone";

export interface ZoneRowInput {
  id: string;
  code: string;
  name: string;
  shape: ZoneShape;
  sortOrder: number;
  parentZoneId: string | null;
}

export interface ZoneRow extends ZoneRowInput {
  /** 0 for a top-level zone; children indent under their parent. */
  depth: number;
  workPackageCount: number;
}

function compare(a: ZoneRowInput, b: ZoneRowInput): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "th");
}

export function buildZoneList(
  zones: ReadonlyArray<ZoneRowInput>,
  workPackageCounts: Readonly<Record<string, number>>,
): ZoneRow[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));

  // A parent that is absent from THIS list is not necessarily deleted — it can
  // simply be invisible to this reader through RLS. Dropping the child would
  // hide a zone that exists, so an unresolvable parent degrades to top level.
  const isRoot = (zone: ZoneRowInput) => zone.parentZoneId === null || !byId.has(zone.parentZoneId);

  const childrenOf = new Map<string, ZoneRowInput[]>();
  for (const zone of zones) {
    if (isRoot(zone)) continue;
    const siblings = childrenOf.get(zone.parentZoneId!) ?? [];
    siblings.push(zone);
    childrenOf.set(zone.parentZoneId!, siblings);
  }

  const out: ZoneRow[] = [];
  const emitted = new Set<string>();

  const walk = (zone: ZoneRowInput, depth: number) => {
    // U1 blocks a self-parent but NOT a two-node cycle, so termination cannot
    // rest on the data being a tree. `emitted` is what makes this total.
    if (emitted.has(zone.id)) return;
    emitted.add(zone.id);
    out.push({ ...zone, depth, workPackageCount: workPackageCounts[zone.id] ?? 0 });
    for (const child of [...(childrenOf.get(zone.id) ?? [])].sort(compare)) {
      walk(child, depth + 1);
    }
  };

  for (const zone of [...zones].filter(isRoot).sort(compare)) walk(zone, 0);
  // Anything still unemitted is inside a cycle: show it rather than lose it.
  for (const zone of [...zones].filter((z) => !emitted.has(z.id)).sort(compare)) walk(zone, 0);

  return out;
}

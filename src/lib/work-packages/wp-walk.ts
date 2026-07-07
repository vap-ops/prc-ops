// Spec 278 U1 — the "งานถัดไป" walk resolver. Telemetry shows the SA's whole loop
// is project ⇄ WP; after shooting a WP they back out to the list and tap the next.
// This lets the WP detail offer prev/next directly. The walk set is the project's
// non-complete leaf WPs (plus the current one, so you can step off a just-completed
// WP), ordered by code — lens-independent and stable. Pure so it's unit-testable;
// the page supplies the RLS-scoped rows.

import type { WorkPackageStatus } from "@/lib/db/enums";

export interface LeafWpRow {
  id: string;
  code: string;
  status: WorkPackageStatus;
}

export interface WpWalkStop {
  id: string;
  code: string;
}

export interface WpWalk {
  prev: WpWalkStop | null;
  next: WpWalkStop | null;
  /** 0-based position of the current WP in the walk, or -1 if absent. */
  index: number;
  total: number;
}

export function wpWalkFrom(leafWps: ReadonlyArray<LeafWpRow>, currentId: string): WpWalk {
  const seq: WpWalkStop[] = leafWps
    .filter((w) => w.status !== "complete" || w.id === currentId)
    .map((w) => ({ id: w.id, code: w.code }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const index = seq.findIndex((w) => w.id === currentId);
  if (index === -1) return { prev: null, next: null, index: -1, total: seq.length };

  return {
    prev: index > 0 ? seq[index - 1]! : null,
    next: index < seq.length - 1 ? seq[index + 1]! : null,
    index,
    total: seq.length,
  };
}

// Spec 92 Unit B — critical-path computation (pure). Given WPs with planned
// windows + finish-to-start dependencies, return the set of WP ids on the
// critical path: the longest dependency chain (by planned duration) whose slip
// slips the project finish. A WP is critical when its total float is zero.
//
// Pure + deterministic (Date.parse on ISO dates only) so it unit-tests cleanly
// and runs server-side per project (~80 WPs — trivial). is_critical is computed
// on read, never stored (spec 92 data model).

export interface ScheduledWp {
  id: string;
  /** ISO date (YYYY-MM-DD) or null when unscheduled. */
  plannedStart: string | null;
  plannedEnd: string | null;
}

export interface DependencyEdge {
  predecessorId: string;
  successorId: string;
}

const DAY_MS = 86_400_000;

function durationDays(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const ms = Date.parse(end) - Date.parse(start);
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.round(ms / DAY_MS);
}

/** Kahn topological order; null if the graph has a cycle. */
function topoOrder(
  ids: readonly string[],
  succs: Map<string, string[]>,
  preds: Map<string, string[]>,
): string[] | null {
  const indeg = new Map<string, number>();
  for (const id of ids) indeg.set(id, preds.get(id)?.length ?? 0);
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const s of succs.get(id) ?? []) {
      const d = (indeg.get(s) ?? 0) - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  return order.length === ids.length ? order : null;
}

/**
 * Returns the set of WP ids on the critical path. Empty when there are no
 * dependencies (no precedence structure to derive a path from) or when a cycle
 * is present (defensive — the add RPC already rejects cycles).
 */
export function criticalWorkPackageIds(
  items: readonly ScheduledWp[],
  edges: readonly DependencyEdge[],
): Set<string> {
  if (edges.length === 0) return new Set();

  const ids = items.map((w) => w.id);
  const idSet = new Set(ids);
  const dur = new Map<string, number>();
  for (const w of items) dur.set(w.id, durationDays(w.plannedStart, w.plannedEnd));

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  const onEdge = new Set<string>();
  for (const e of edges) {
    if (!idSet.has(e.predecessorId) || !idSet.has(e.successorId)) continue;
    succs.get(e.predecessorId)?.push(e.successorId);
    preds.get(e.successorId)?.push(e.predecessorId);
    onEdge.add(e.predecessorId);
    onEdge.add(e.successorId);
  }

  const order = topoOrder(ids, succs, preds);
  if (!order) return new Set();

  // Forward pass — earliest finish.
  const ef = new Map<string, number>();
  for (const id of order) {
    const ps = preds.get(id) ?? [];
    const earliestStart = ps.length ? Math.max(...ps.map((p) => ef.get(p) ?? 0)) : 0;
    ef.set(id, earliestStart + (dur.get(id) ?? 0));
  }
  const projectEnd = ids.reduce((m, id) => Math.max(m, ef.get(id) ?? 0), 0);

  // Backward pass — latest finish.
  const lf = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const ss = succs.get(id) ?? [];
    lf.set(
      id,
      ss.length
        ? Math.min(...ss.map((s) => (lf.get(s) ?? projectEnd) - (dur.get(s) ?? 0)))
        : projectEnd,
    );
  }

  // Critical = zero total float, on an actual edge, with real duration.
  const critical = new Set<string>();
  for (const id of ids) {
    const floatDays = (lf.get(id) ?? 0) - (ef.get(id) ?? 0);
    if (floatDays === 0 && onEdge.has(id) && (dur.get(id) ?? 0) > 0) critical.add(id);
  }
  return critical;
}

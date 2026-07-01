// Spec 244 U4 / ADR 0068 (Tier B) — pure view helpers behind the super_admin UX
// friction map: rank SCREENS by how much friction they generate (aggregate across
// all users) so the team gets a fix-list. No DB/DOM here — the caller passes the
// friction rows in — so the route-normalization + grouping logic is unit-testable.
//
// v1 ranks by ABSOLUTE friction count per screen; a per-view RATE (friction ÷
// route_views) is the honest normalization but needs the high-volume route_view
// denominator aggregated server-side (a partial index + RPC / rollup) — deferred as a
// documented scale-up. Absolute counts still surface the screens users hit friction
// on most, which is an actionable fix-list.

import type { FrictionEventType } from "@/lib/telemetry/session";

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;

// The tracker captures the raw pathname (with ids). Collapse id-like segments (uuids,
// numeric ids) to ':id' so grouping is by SCREEN, not fragmented per project / WP /
// request. Aggregate dimension only — never content.
export function normalizeRoute(path: string | null | undefined): string {
  if (!path) return "/";
  const segs = path
    .split("/")
    .filter(Boolean)
    .map((s) => (UUID_SEGMENT.test(s) || NUMERIC_SEGMENT.test(s) ? ":id" : s));
  return segs.length === 0 ? "/" : "/" + segs.join("/");
}

export interface RouteFriction {
  route: string; // normalized
  total: number;
  byType: Partial<Record<FrictionEventType, number>>;
}

// Group friction events by normalized route → per-route total + per-type breakdown,
// ranked by total desc (route name asc for stable ties).
export function buildFrictionMap(
  rows: ReadonlyArray<{ route: string | null; event_type: FrictionEventType }>,
): RouteFriction[] {
  const byRoute = new Map<string, RouteFriction>();
  for (const r of rows) {
    const route = normalizeRoute(r.route);
    let acc = byRoute.get(route);
    if (!acc) {
      acc = { route, total: 0, byType: {} };
      byRoute.set(route, acc);
    }
    acc.total += 1;
    acc.byType[r.event_type] = (acc.byType[r.event_type] ?? 0) + 1;
  }
  return [...byRoute.values()].sort((a, b) => b.total - a.total || a.route.localeCompare(b.route));
}

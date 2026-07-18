// Spec 327 U5 — the ทรัพยากร material-coverage core (pure, no I/O). Per WP
// (+ a project bucket for null-WP plan lines, §0.1) the plan's items split
// into ในคลัง / กำลังมา / ยังไม่สั่งซื้อ — ITEM-presence counting, not qty
// arithmetic across items (units differ per item; the UI labels the
// approximation, §0.5):
//
// - ในคลัง: project stock covers the item's planned qty (plan qty and stock
//   qty share the item's canonical unit — both keyed catalog_item_id — so the
//   per-item compare is safe).
// - กำลังมา: not covered, but an ACTIVE in_transit PR carries the item.
//   to_order / awaiting_approval do NOT count — nothing is on a truck yet
//   (they read as ยังไม่สั่งซื้อ, the actionable state).
// - ยังไม่สั่งซื้อ: neither — and the items are NAMED (§0.2), not a percentage.
//
// Legacy free-text PRs (catalog_item_id null) can't be item-matched — part of
// the labeled approximation. Stock is PROJECT grain: two WPs planning the same
// item both read the same pool (the grain caption states this).

import type { Database } from "@/lib/db/database.types";
import { requestBand } from "./request-bands";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export interface CoveragePlanLine {
  workPackageId: string | null;
  catalogItemId: string;
  qty: number;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
}

export interface CoverageStockRow {
  catalogItemId: string;
  qtyOnHand: number;
}

export interface CoveragePrRow {
  status: PurchaseRequestStatus;
  catalogItemId: string | null;
}

export interface NamedItem {
  baseItem: string;
  specAttrs: string | null;
  unit: string;
}

export interface WpCoverage {
  plannedItems: number;
  inStock: number;
  incoming: number;
  notOrdered: number;
  notOrderedItems: NamedItem[];
}

const EMPTY = (): WpCoverage => ({
  plannedItems: 0,
  inStock: 0,
  incoming: 0,
  notOrdered: 0,
  notOrderedItems: [],
});

export function buildMaterialCoverage(
  planLines: ReadonlyArray<CoveragePlanLine>,
  stockRows: ReadonlyArray<CoverageStockRow>,
  prRows: ReadonlyArray<CoveragePrRow>,
): { byWp: Map<string, WpCoverage>; projectBucket: WpCoverage } {
  const stockByItem = new Map<string, number>();
  for (const s of stockRows) {
    stockByItem.set(s.catalogItemId, (stockByItem.get(s.catalogItemId) ?? 0) + s.qtyOnHand);
  }
  const incomingItems = new Set(
    prRows
      .filter((r) => requestBand(r.status) === "in_transit" && r.catalogItemId !== null)
      .map((r) => r.catalogItemId as string),
  );

  // Per (WP-or-bucket, item): sum planned qty across lines first.
  type ItemAgg = { qty: number; named: NamedItem };
  const perScope = new Map<string | null, Map<string, ItemAgg>>();
  for (const l of planLines) {
    const scope = perScope.get(l.workPackageId) ?? new Map<string, ItemAgg>();
    const agg = scope.get(l.catalogItemId) ?? {
      qty: 0,
      named: { baseItem: l.baseItem, specAttrs: l.specAttrs, unit: l.unit },
    };
    agg.qty += l.qty;
    scope.set(l.catalogItemId, agg);
    perScope.set(l.workPackageId, scope);
  }

  const coverScope = (items: Map<string, ItemAgg>): WpCoverage => {
    const cov = EMPTY();
    for (const [itemId, agg] of items) {
      cov.plannedItems += 1;
      if ((stockByItem.get(itemId) ?? 0) >= agg.qty) cov.inStock += 1;
      else if (incomingItems.has(itemId)) cov.incoming += 1;
      else {
        cov.notOrdered += 1;
        cov.notOrderedItems.push(agg.named);
      }
    }
    return cov;
  };

  const byWp = new Map<string, WpCoverage>();
  let projectBucket = EMPTY();
  for (const [scopeKey, items] of perScope) {
    if (scopeKey === null) projectBucket = coverScope(items);
    else byWp.set(scopeKey, coverScope(items));
  }
  return { byWp, projectBucket };
}

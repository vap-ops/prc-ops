// Spec 268 — pure view model for /equipment/rentals. Composes the rental
// cards the page renders: rate label (฿…/เดือน | ฿…/วัน — the money format
// SSOT), period label (dated custom duration vs open-ended "whole project"),
// supplier/project name joins, newest-first ordering, per-batch allocation
// chips. Presentation only — the page feeds it admin-client reads (batches +
// allocations are zero-grant money tables, ADR 0055 decision 6).
//
// Spec 275 U1 (ADR 0078): the rental payee is a SUPPLIER (vendor unification),
// not an equipment_owner — the batch's party is supplierId/supplierName.

import { bahtWithSymbol } from "@/lib/format";
import { formatThaiDate } from "@/lib/i18n/labels";

export type RentalRatePeriod = "monthly" | "daily";

const RATE_PERIOD_SUFFIX: Record<RentalRatePeriod, string> = {
  monthly: "/เดือน",
  daily: "/วัน",
};

export interface RentalBatchRow {
  id: string;
  supplierId: string;
  rate: number;
  ratePeriod: RentalRatePeriod;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
  // Spec 312: equipment_rental_batch status (active | settled | returned |
  // cancelled). A cancelled batch is dropped from the list; only an active one
  // is voidable.
  status: string;
  createdAt: string;
}

export interface RentalAllocationRow {
  id: string;
  batchId: string;
  projectId: string;
  startsOn: string;
  endsOn: string | null;
}

export interface RentalAllocationChip {
  id: string;
  projectName: string;
  periodLabel: string;
}

export interface RentalCard {
  id: string;
  supplierName: string;
  rateLabel: string;
  periodLabel: string;
  note: string | null;
  // Spec 312: only an active batch can be voided (a settled/returned one shows
  // but has no void control).
  voidable: boolean;
  allocations: RentalAllocationChip[];
}

const NAME_FALLBACK = "—";

export function rentalRateLabel(rate: number, period: RentalRatePeriod): string {
  return `${bahtWithSymbol(rate)}${RATE_PERIOD_SUFFIX[period]}`;
}

export function rentalPeriodLabel(startsOn: string, endsOn: string | null): string {
  if (endsOn === null) {
    return `เริ่ม ${formatThaiDate(startsOn)} · ตลอดโครงการ (จนกว่าจะคืน)`;
  }
  return `${formatThaiDate(startsOn)} – ${formatThaiDate(endsOn)}`;
}

export function buildRentalView(
  batches: readonly RentalBatchRow[],
  allocations: readonly RentalAllocationRow[],
  suppliers: readonly { id: string; name: string }[],
  projects: readonly { id: string; name: string }[],
): RentalCard[] {
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const chipsByBatch = new Map<string, RentalAllocationChip[]>();
  for (const a of allocations) {
    const chip: RentalAllocationChip = {
      id: a.id,
      projectName: projectName.get(a.projectId) ?? NAME_FALLBACK,
      periodLabel: rentalPeriodLabel(a.startsOn, a.endsOn),
    };
    const list = chipsByBatch.get(a.batchId);
    if (list) list.push(chip);
    else chipsByBatch.set(a.batchId, [chip]);
  }

  return (
    [...batches]
      // Spec 312: a voided (cancelled) batch is hidden — the reversed GL + audit
      // row are the history, not a stale card.
      .filter((b) => b.status !== "cancelled")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((b) => ({
        id: b.id,
        supplierName: supplierName.get(b.supplierId) ?? NAME_FALLBACK,
        rateLabel: rentalRateLabel(b.rate, b.ratePeriod),
        periodLabel: rentalPeriodLabel(b.startsOn, b.endsOn),
        note: b.note,
        voidable: b.status === "active",
        allocations: chipsByBatch.get(b.id) ?? [],
      }))
  );
}

// Spec 280 — which suppliers PRC has rented from before, ranked, so the rental
// recorder can surface them above the full supplier list (show-all fallback keeps
// everyone reachable). Derived from equipment_rental_batches — no declared tags.
// Rank: batch count desc, then most-recent batch (created_at) desc, nulls last.
export function rankRentalVendors(
  batches: ReadonlyArray<{ supplier_id: string | null; created_at: string | null }>,
): string[] {
  const stat = new Map<string, { count: number; last: string | null }>();
  for (const b of batches) {
    if (!b.supplier_id) continue;
    const cur = stat.get(b.supplier_id) ?? { count: 0, last: null };
    cur.count += 1;
    if (b.created_at !== null && (cur.last === null || b.created_at > cur.last)) {
      cur.last = b.created_at;
    }
    stat.set(b.supplier_id, cur);
  }
  return [...stat.entries()]
    .sort(([, a], [, b]) => {
      if (b.count !== a.count) return b.count - a.count;
      const at = a.last;
      const bt = b.last;
      if (at === bt) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return at > bt ? -1 : 1;
    })
    .map(([id]) => id);
}

// Spec 268 — pure view model for /equipment/rentals. Composes the rental
// cards the page renders: rate label (฿…/เดือน | ฿…/วัน — the money format
// SSOT), period label (dated custom duration vs open-ended "whole project"),
// owner/project name joins, newest-first ordering, per-batch allocation
// chips. Presentation only — the page feeds it admin-client reads (batches +
// allocations are zero-grant money tables, ADR 0055 decision 6).

import { bahtWithSymbol } from "@/lib/format";
import { formatThaiDate } from "@/lib/i18n/labels";

export type RentalRatePeriod = "monthly" | "daily";

const RATE_PERIOD_SUFFIX: Record<RentalRatePeriod, string> = {
  monthly: "/เดือน",
  daily: "/วัน",
};

export interface RentalBatchRow {
  id: string;
  ownerId: string;
  rate: number;
  ratePeriod: RentalRatePeriod;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
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
  ownerName: string;
  rateLabel: string;
  periodLabel: string;
  note: string | null;
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
  owners: readonly { id: string; name: string }[],
  projects: readonly { id: string; name: string }[],
): RentalCard[] {
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
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

  return [...batches]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((b) => ({
      id: b.id,
      ownerName: ownerName.get(b.ownerId) ?? NAME_FALLBACK,
      rateLabel: rentalRateLabel(b.rate, b.ratePeriod),
      periodLabel: rentalPeriodLabel(b.startsOn, b.endsOn),
      note: b.note,
      allocations: chipsByBatch.get(b.id) ?? [],
    }));
}

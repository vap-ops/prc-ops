// Spec 275 U4 — the rental variance roll-up (pure; the agreement-detail surface
// feeds it admin-client reads). For one rental agreement (a batch), it reconciles
// three money figures — mirroring the subcontracts "Σ agreed vs Σ paid" roll-up:
//
//   • chargedToWp   — what PRC charges its own WPs for this equipment: Σ over the
//     agreement's items' CURRENT usage logs of billable-days × daily_rate_snapshot.
//     Exactly the wp_equipment_sell basis (spec 146 U3): days are inclusive
//     (same-day = 1) and an open checkout accrues to today.
//   • paidToVendor  — Σ net_amount over the agreement's CURRENT settlements (the
//     supersede anti-join). net is base + overtime + fees; the deposit is not part
//     of it (ADR 0078).
//   • committed     — the agreement's own rate × period, a display estimate.
//
// The recovery flag is charged vs paid: charged > paid = PRC keeps a margin
// (over-recovery); charged < paid = PRC eats the gap (under-recovery). Committed is
// shown for context but is not part of the flag.

import { round2 } from "@/lib/format";
import { currentSettlements } from "@/lib/equipment/rental-settlement-view";
import type { RentalRatePeriod } from "@/lib/equipment/rental-view";

// Days per month used to prorate a monthly rate into a committed estimate. The
// agreement stores one monthly figure; committed spreads it across the elapsed days
// (an estimate for display — the real bill is the vendor's invoiced settlements).
const DAYS_PER_MONTH = 30;

/** ISO yyyy-mm-dd → whole UTC day index (avoids DST drift in date-only math). */
function toUtcDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/** Inclusive day count between two ISO dates (same day = 1); never negative. */
export function inclusiveDays(from: string, to: string): number {
  return Math.max(Math.round(toUtcDays(to) - toUtcDays(from)) + 1, 0);
}

export type RentalRecoveryFlag = "over_recovery" | "under_recovery" | "balanced";

export interface RentalVarianceUsageRow {
  id: string;
  supersededBy: string | null;
  checkedOutOn: string;
  checkedInOn: string | null;
  dailyRateSnapshot: number;
}

export interface RentalVarianceSettlementRow {
  id: string;
  supersededBy: string | null;
  netAmount: number;
}

export interface RentalCommitment {
  rate: number;
  ratePeriod: RentalRatePeriod;
  startsOn: string;
  endsOn: string | null;
}

export interface RentalVariance {
  chargedToWp: number;
  paidToVendor: number;
  committed: number;
  flag: RentalRecoveryFlag;
}

export function computeRentalVariance(input: {
  usage: readonly RentalVarianceUsageRow[];
  settlements: readonly RentalVarianceSettlementRow[];
  committed: RentalCommitment;
  today: string;
}): RentalVariance {
  const { today, committed } = input;

  const chargedToWp = round2(
    currentSettlements(input.usage).reduce(
      (sum, u) => sum + inclusiveDays(u.checkedOutOn, u.checkedInOn ?? today) * u.dailyRateSnapshot,
      0,
    ),
  );

  const paidToVendor = round2(
    currentSettlements(input.settlements).reduce((sum, s) => sum + s.netAmount, 0),
  );

  const periodDays = inclusiveDays(committed.startsOn, committed.endsOn ?? today);
  const committedAmount = round2(
    committed.ratePeriod === "daily"
      ? committed.rate * periodDays
      : committed.rate * (periodDays / DAYS_PER_MONTH),
  );

  const flag: RentalRecoveryFlag =
    chargedToWp > paidToVendor
      ? "over_recovery"
      : chargedToWp < paidToVendor
        ? "under_recovery"
        : "balanced";

  return { chargedToWp, paidToVendor, committed: committedAmount, flag };
}

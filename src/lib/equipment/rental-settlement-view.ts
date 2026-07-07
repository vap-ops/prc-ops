// Spec 275 U3 — pure view helpers for the rental-settlement (vendor invoice)
// recorder. Presentation/derivation only; the page feeds these admin-client reads
// (rental_settlements + equipment_rental_batches are zero-grant money tables).
//
// The settlement is a back-office vendor invoice against a rental agreement
// (batch). `net = base + overtime + fees` is the rental cost only — the deposit is
// resolved separately and is NEVER netted here (ADR 0078 deposit-as-asset).

import { round2 } from "@/lib/format";
import {
  rentalPeriodLabel,
  rentalRateLabel,
  type RentalRatePeriod,
} from "@/lib/equipment/rental-view";

export type ReceiptMethod = "bank_transfer" | "cheque" | "cash";

/** net = base + overtime + fees, rounded to 2dp (money compare). The deposit is
 *  not part of net — it is a separate prepaid asset (ADR 0078). */
export function settlementNet(base: number, overtime: number, fees: number): number {
  return round2(base + overtime + fees);
}

export interface AgreementRow {
  id: string;
  supplierName: string;
  rate: number;
  ratePeriod: RentalRatePeriod;
  startsOn: string;
  endsOn: string | null;
}

export interface AgreementOption {
  id: string;
  label: string;
}

/** The agreement <select> labels: supplier · rate · period (reusing the rental
 *  card SSOT formatters). */
export function buildAgreementOptions(rows: readonly AgreementRow[]): AgreementOption[] {
  return rows.map((r) => ({
    id: r.id,
    label: `${r.supplierName} · ${rentalRateLabel(r.rate, r.ratePeriod)} · ${rentalPeriodLabel(
      r.startsOn,
      r.endsOn,
    )}`,
  }));
}

// One live settlement, as the page hands it to the manager: display fields plus
// every amount so the correction form can prefill and supersede it.
export interface SettlementListItem {
  id: string;
  agreementId: string;
  agreementLabel: string;
  invoiceNo: string;
  invoiceDate: string;
  base: number;
  overtime: number;
  fees: number;
  net: number;
  vat: number;
  depositRefunded: number;
  depositForfeited: number;
  method: ReceiptMethod;
  note: string | null;
}

export interface SupersededAware {
  id: string;
  supersededBy: string | null;
}

/** The live settlements — the supersede anti-join. A settlement is superseded
 *  when a newer row's `superseded_by` points back at it (the subcontract
 *  convention: the correcting row carries the pointer, ADR 0078 / spec 251), so
 *  the current set excludes any row that is pointed at. */
export function currentSettlements<T extends SupersededAware>(rows: readonly T[]): T[] {
  const replaced = new Set(
    rows.map((r) => r.supersededBy).filter((id): id is string => id !== null),
  );
  return rows.filter((r) => !replaced.has(r.id));
}

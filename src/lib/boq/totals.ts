// Spec 237 (ADR 0066 / S10-U2) — the pure BOQ money helpers. A BOQ line carries
// its rates ON THE LINE (spec 236 / D6: material_rate + labor_rate), so the line
// total is qty × (material + labor) and the template total is the Σ of those.
// Both round through the format.ts SSOT (round2) — money never re-rolls rounding.

import { round2 } from "@/lib/format";

/** The minimal shape needed to total a line — qty plus its two rates. */
export interface BoqLineTotalInput {
  qty: number;
  materialRate: number;
  laborRate: number;
}

/** qty × (material_rate + labor_rate), rounded to 2dp. */
export function lineTotal({ qty, materialRate, laborRate }: BoqLineTotalInput): number {
  return round2(qty * (materialRate + laborRate));
}

/** Σ of the line totals, rounded to 2dp (empty → 0). */
export function templateTotal(lines: readonly BoqLineTotalInput[]): number {
  return round2(lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

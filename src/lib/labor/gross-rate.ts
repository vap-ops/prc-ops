// Spec 368 U1 / ADR 0082 — the gross day-rate derivation, shared by the
// /settings/labor-rates editor and the /workers cost-confirm preview.
//
// Re-derives the DB's level_gross_rate() in TS because that function is
// owner/DEFINER-only and cannot be called from the admin client. The DB value
// stays canonical — a half-cent float boundary could differ from this preview by
// 0.01 — so this is display-only, never a value we write.
//
// Formula (identical to the RPC): before_wht → the entered rate as-is;
// after_wht → entered / (1 − pct/100), 2dp.

import type { WhtBasis } from "@/lib/db/enums";
import { round2 } from "@/lib/format";

export function grossRate(
  entered: number | null,
  basis: WhtBasis,
  pct: number | null,
): number | null {
  if (entered === null) return null;
  if (basis === "before_wht") return entered;
  const p = pct ?? 0;
  return round2(entered / (1 - p / 100));
}

// Spec 146 U1 — pure validation for the per-item equipment daily-rate.
// MONEY (ADR 0055 decision 5): the per-item charge-out rate PRC sets. This is
// the UI gate before the set_equipment_daily_rate RPC (pm/super/procurement);
// the RPC + DB CHECK (daily_rate is null or >= 0) re-guard. A rate SET is a
// non-negative number — null/undefined is rejected (clearing a rate is not a
// U1 use case; mirrors set_worker_day_rate, which rejects null).

export type ValidateDailyRateResult = { ok: true; value: number } | { ok: false; error: string };

export function validateEquipmentDailyRate(
  rate: number | null | undefined,
): ValidateDailyRateResult {
  if (rate === null || rate === undefined) {
    return { ok: false, error: "กรุณาระบุค่าเช่าต่อวัน" };
  }
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    return { ok: false, error: "ค่าเช่าต่อวันไม่ถูกต้อง" };
  }
  if (rate < 0) {
    return { ok: false, error: "ค่าเช่าต่อวันต้องไม่ติดลบ" };
  }
  return { ok: true, value: rate };
}

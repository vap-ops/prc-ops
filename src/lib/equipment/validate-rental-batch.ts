// Spec 146 U1 — pure validation for the inbound equipment_rental_batches header
// (PRC's monthly cost for a rented set). MONEY (ADR 0055 decision 5): the UI
// gate before create_equipment_rental_batch (pm/super/procurement). Mirrors the
// DB CHECKs (monthly_rate >= 0; ends_on >= starts_on) so the form fails
// friendly. Dates are ISO YYYY-MM-DD strings compared lexicographically
// (= chronological); no Date parsing (the `date` column + CHECK are the real
// guard, including calendar correctness like 2026-02-31).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export interface RentalBatchInput {
  monthlyRate: number;
  startsOn: string;
  endsOn: string | null;
}

export type ValidateRentalBatchResult =
  | { ok: true; value: RentalBatchInput }
  | { ok: false; error: string };

export function validateRentalBatch(input: {
  monthlyRate: number;
  startsOn: string;
  endsOn: string | null;
}): ValidateRentalBatchResult {
  if (typeof input.monthlyRate !== "number" || !Number.isFinite(input.monthlyRate)) {
    return { ok: false, error: "ค่าเช่าต่อเดือนไม่ถูกต้อง" };
  }
  if (input.monthlyRate < 0) {
    return { ok: false, error: "ค่าเช่าต่อเดือนต้องไม่ติดลบ" };
  }

  const startsOn = input.startsOn.trim();
  if (startsOn.length === 0) {
    return { ok: false, error: "กรุณาระบุวันเริ่มเช่า" };
  }
  if (!isIsoDate(startsOn)) {
    return { ok: false, error: "วันเริ่มเช่าไม่ถูกต้อง" };
  }

  const endsOnRaw = (input.endsOn ?? "").trim();
  const endsOn = endsOnRaw.length === 0 ? null : endsOnRaw;
  if (endsOn !== null) {
    if (!isIsoDate(endsOn)) {
      return { ok: false, error: "วันสิ้นสุดเช่าไม่ถูกต้อง" };
    }
    if (endsOn < startsOn) {
      return { ok: false, error: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม" };
    }
  }

  return { ok: true, value: { monthlyRate: input.monthlyRate, startsOn, endsOn } };
}

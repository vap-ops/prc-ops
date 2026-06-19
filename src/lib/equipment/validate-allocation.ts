// Spec 146 U2 — pure validation for an equipment_project_allocations row:
// committing a rental batch (its monthly cost) to a project for a period
// (ADR 0055 decisions 4/8). The UI gate before
// create_equipment_project_allocation; the RPC + DB CHECK (ends_on >= starts_on)
// re-guard. Dates are ISO YYYY-MM-DD compared lexicographically (= chronological);
// no Date parsing (the `date` column + CHECK are the real guard, incl. calendar
// correctness like 2026-02-31). Date logic mirrors validate-rental-batch; kept a
// separate module per scope discipline (a shared iso-date helper is a seam).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export interface AllocationInput {
  startsOn: string;
  endsOn: string | null;
}

export type ValidateAllocationResult =
  | { ok: true; value: AllocationInput }
  | { ok: false; error: string };

export function validateAllocation(input: {
  startsOn: string;
  endsOn: string | null;
}): ValidateAllocationResult {
  const startsOn = input.startsOn.trim();
  if (startsOn.length === 0) {
    return { ok: false, error: "กรุณาระบุวันเริ่ม" };
  }
  if (!isIsoDate(startsOn)) {
    return { ok: false, error: "วันเริ่มไม่ถูกต้อง" };
  }

  const endsOnRaw = (input.endsOn ?? "").trim();
  const endsOn = endsOnRaw.length === 0 ? null : endsOnRaw;
  if (endsOn !== null) {
    if (!isIsoDate(endsOn)) {
      return { ok: false, error: "วันสิ้นสุดไม่ถูกต้อง" };
    }
    if (endsOn < startsOn) {
      return { ok: false, error: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม" };
    }
  }

  return { ok: true, value: { startsOn, endsOn } };
}

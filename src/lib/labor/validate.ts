// Spec 46 P1 — pure validation for daily labor capture. Messages are
// Thai (field-facing). Dates are ISO YYYY-MM-DD strings compared
// lexically (valid for ISO dates); "today" is injected by the caller,
// resolved in Asia/Bangkok (C7).

import type { Database } from "@/lib/db/database.types";
import type { UserRole } from "@/lib/db/enums";
import { ISO_DATE_REGEX } from "@/lib/dates";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { DC_PAYMENT_METHODS } from "./payments";

type DayFraction = Database["public"]["Enums"]["day_fraction"];

const BACKDATE_LIMIT_DAYS = 14;
const REASON_MAX_LENGTH = 300;

// Spec 127 U2 — record-DC-payment form validation (PM-facing).
const PAYMENT_REFERENCE_MAX = 120;
const PAYMENT_NOTE_MAX = 500;
// numeric(12,2) holds < 10^10; reject anything that would overflow the column.
const PAYMENT_AMOUNT_MAX = 1e10;

// Date.parse is lenient about day overflow ("2026-02-31" rolls to March), so
// round-trip the components instead — rejects impossible days and months.
function isIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const parts = value.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateDcPayment(input: {
  contractorId: string;
  from: string;
  to: string;
  paidAt: string;
  paidAmount: number;
  method: string;
  reference: string;
  note: string;
}): string | null {
  if (!UUID_REGEX.test(input.contractorId)) {
    return "ข้อมูลไม่ถูกต้อง";
  }
  if (!isIsoDate(input.from) || !isIsoDate(input.to) || input.to < input.from) {
    return "ช่วงวันที่ไม่ถูกต้อง";
  }
  if (!isIsoDate(input.paidAt)) {
    return "วันที่จ่ายไม่ถูกต้อง";
  }
  if (
    !Number.isFinite(input.paidAmount) ||
    input.paidAmount < 0 ||
    input.paidAmount >= PAYMENT_AMOUNT_MAX
  ) {
    return "จำนวนเงินไม่ถูกต้อง";
  }
  if (!(DC_PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    return "เลือกวิธีจ่ายเงิน";
  }
  if (input.reference.length > PAYMENT_REFERENCE_MAX) {
    return `เลขอ้างอิงยาวเกิน ${PAYMENT_REFERENCE_MAX} ตัวอักษร`;
  }
  if (input.note.length > PAYMENT_NOTE_MAX) {
    return `หมายเหตุยาวเกิน ${PAYMENT_NOTE_MAX} ตัวอักษร`;
  }
  return null;
}

const BACKOFFICE_BACKDATE_ROLES: ReadonlySet<UserRole> = new Set([
  "project_manager",
  "super_admin",
]);

function daysBetween(earlierIso: string, laterIso: string): number {
  return Math.round((Date.parse(laterIso) - Date.parse(earlierIso)) / 86_400_000);
}

export function validateLaborEntry(
  entry: { workDate: string; workerIds: string[] },
  context: { today: string; role: UserRole },
): string | null {
  if (!ISO_DATE_REGEX.test(entry.workDate) || Number.isNaN(Date.parse(entry.workDate))) {
    return "วันที่ไม่ถูกต้อง";
  }
  if (entry.workDate > context.today) {
    return "ลงบันทึกล่วงหน้า (วันที่ในอนาคต) ไม่ได้";
  }
  if (entry.workerIds.length === 0) {
    return "ยังไม่ได้เลือกทีมงาน";
  }
  if (
    daysBetween(entry.workDate, context.today) > BACKDATE_LIMIT_DAYS &&
    !BACKOFFICE_BACKDATE_ROLES.has(context.role)
  ) {
    return `ย้อนหลังได้ไม่เกิน ${BACKDATE_LIMIT_DAYS} วัน — แจ้งผู้จัดการโครงการ`;
  }
  return null;
}

export function validateCorrection(correction: {
  reason: string;
  fraction: DayFraction | null;
  tombstone: boolean;
}): string | null {
  const reason = correction.reason.trim();
  if (reason.length === 0) {
    return "ต้องระบุเหตุผล";
  }
  if (reason.length > REASON_MAX_LENGTH) {
    return `เหตุผลยาวเกิน ${REASON_MAX_LENGTH} ตัวอักษร`;
  }
  if (!correction.tombstone && correction.fraction === null) {
    return "ต้องเลือกเต็มวันหรือครึ่งวัน";
  }
  return null;
}

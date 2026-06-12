// Spec 46 P1 — pure validation for daily labor capture. Messages are
// Thai (field-facing). Dates are ISO YYYY-MM-DD strings compared
// lexically (valid for ISO dates); "today" is injected by the caller,
// resolved in Asia/Bangkok (C7).

import type { Database } from "@/lib/db/database.types";

type UserRole = Database["public"]["Enums"]["user_role"];
type DayFraction = Database["public"]["Enums"]["day_fraction"];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BACKDATE_LIMIT_DAYS = 14;
const REASON_MAX_LENGTH = 300;

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
  if (!ISO_DATE_PATTERN.test(entry.workDate) || Number.isNaN(Date.parse(entry.workDate))) {
    return "วันที่ไม่ถูกต้อง";
  }
  if (entry.workDate > context.today) {
    return "ลงบันทึกล่วงหน้า (วันที่ในอนาคต) ไม่ได้";
  }
  if (entry.workerIds.length === 0) {
    return "ยังไม่ได้เลือกคนงาน";
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

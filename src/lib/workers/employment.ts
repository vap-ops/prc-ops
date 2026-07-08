// Spec 266 U3 (ADR 0073) — สถานะ (employment_type) label SSOT. Single-sourced
// (ui-term-consistency) now that both the worker roster manager and the SA team
// view render ประจำ/ชั่วคราว. Tenure, orthogonal to การจ่าย (pay_type): a monthly
// ช่าง can still be temporary. Internal (ประจำ) vs day-hired (ชั่วคราว).

import type { Database } from "@/lib/db/database.types";

export type EmploymentType = Database["public"]["Enums"]["employment_type"];

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  permanent: "ประจำ",
  temporary: "ชั่วคราว",
};

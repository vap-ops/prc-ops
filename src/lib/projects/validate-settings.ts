// Project-settings validators (spec 58 / ADR 0042). The
// update_project_settings RPC re-validates the name server-side (22023
// on blank/oversized) — this module is the form's fast feedback and the
// server action's first gate.

import type { ProjectStatus } from "@/lib/db/enums";
import type { Database } from "@/lib/db/database.types";

export type { ProjectStatus };

export const PROJECT_NAME_MAX = 200;

const PROJECT_STATUSES: ReadonlyArray<ProjectStatus> = [
  "active",
  "on_hold",
  "completed",
  "archived",
];

export type ValidateNameResult = { ok: true; name: string } | { ok: false; error: string };

export function validateProjectName(raw: string): ValidateNameResult {
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, error: "กรุณาใส่ชื่อโครงการ" };
  }
  if (name.length > PROJECT_NAME_MAX) {
    return { ok: false, error: `ชื่อโครงการต้องไม่เกิน ${PROJECT_NAME_MAX} ตัวอักษร` };
  }
  return { ok: true, name };
}

export function isValidProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

// ---- Spec 79: project metadata + client ----
// These mirror the update_project_settings RPC's server-side checks (22023);
// this module is the form's fast feedback. All metadata fields are optional —
// blank normalizes to null (the column stays/clears appropriately).

export const SITE_ADDRESS_MAX = 255;
// numeric(12,2): max 10 integer digits + 2 fractional.
export const BUDGET_MAX = 9_999_999_999.99;

export type OptionalTextResult = { ok: true; value: string | null } | { ok: false; error: string };

export function validateSiteAddress(raw: string): OptionalTextResult {
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > SITE_ADDRESS_MAX) {
    return { ok: false, error: `ที่ตั้งโครงการต้องไม่เกิน ${SITE_ADDRESS_MAX} ตัวอักษร` };
  }
  return { ok: true, value };
}

export type BudgetResult = { ok: true; value: number | null } | { ok: false; error: string };

export function validateBudgetAmount(raw: string): BudgetResult {
  const t = raw.trim();
  if (t.length === 0) return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: "งบประมาณไม่ถูกต้อง" };
  if (n < 0) return { ok: false, error: "งบประมาณต้องไม่ติดลบ" };
  if (n > BUDGET_MAX) return { ok: false, error: "งบประมาณเกินขีดจำกัด" };
  // Round to the column's 2 decimal places.
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export type DateResult = { ok: true } | { ok: false; error: string };

// `todayISO` is injected (the form passes Bangkok "today") so this stays a
// pure function. ISO date strings (YYYY-MM-DD) compare lexicographically.
export function validatePlannedCompletionDate(iso: string | null, todayISO: string): DateResult {
  if (!iso) return { ok: true };
  if (iso < todayISO) {
    return { ok: false, error: "วันเสร็จตามแผนต้องไม่เป็นอดีต" };
  }
  return { ok: true };
}

export function validateProjectDates(
  startISO: string | null,
  completionISO: string | null,
): DateResult {
  if (startISO && completionISO && completionISO < startISO) {
    return { ok: false, error: "วันเสร็จต้องไม่ก่อนวันเริ่มโครงการ" };
  }
  return { ok: true };
}

// project_type — the operator-chosen category set. This tuple is the canonical
// value list (the generated Database Enums["project_type"] is structurally
// identical; a type-level check guards drift in labels.ts). Thai labels live
// here so the select and any display read one map.
export const PROJECT_TYPES = [
  "new_building",
  "renovation",
  "factory_warehouse",
  "infrastructure",
  "systems",
  "other",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  new_building: "อาคารใหม่",
  renovation: "ปรับปรุง/ต่อเติม",
  factory_warehouse: "โรงงาน/คลังสินค้า",
  infrastructure: "โครงสร้างพื้นฐาน",
  systems: "งานระบบ",
  other: "อื่นๆ",
};

export function isValidProjectType(value: unknown): value is ProjectType {
  return typeof value === "string" && (PROJECT_TYPES as readonly string[]).includes(value);
}

// Drift guard: PROJECT_TYPES must stay in lockstep with the generated DB enum.
// This assignment fails typecheck if the tuple holds a value not in the enum;
// pgTAP file 42 guards the reverse (the DB has exactly these six values).
const _projectTypesMatchDb: readonly Database["public"]["Enums"]["project_type"][] = PROJECT_TYPES;
void _projectTypesMatchDb;

// Project-settings validators (spec 58 / ADR 0042). The
// update_project_settings RPC re-validates the name server-side (22023
// on blank/oversized) — this module is the form's fast feedback and the
// server action's first gate.

import type { ProjectStatus } from "@/lib/db/enums";

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

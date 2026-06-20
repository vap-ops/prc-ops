// Spec 161 U6b/U12 — the narrow confiscation reasons (confiscation_reason enum).
// SSOT for the Thai labels + the operator picker order. The first three are gross
// violations; defect_rework is the quality clawback (design-rule 1).

import type { Database } from "@/lib/db/database.types";

export type ConfiscationReason = Database["public"]["Enums"]["confiscation_reason"];

export const CONFISCATION_REASONS: ConfiscationReason[] = [
  "fraud",
  "theft",
  "gross_misconduct",
  "defect_rework",
];

export const CONFISCATION_REASON_LABEL: Record<ConfiscationReason, string> = {
  fraud: "ฉ้อโกง",
  theft: "ลักทรัพย์",
  gross_misconduct: "ประพฤติผิดร้ายแรง",
  defect_rework: "งานมีตำหนิ (เรียกคืน)",
};

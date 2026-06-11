// Thai display labels for every user-facing enum (spec 14). Enum values
// are storage keys; the label is presentation (spec 10 doctrine) — these
// maps are the single place screen code looks labels up, replacing the
// per-file STATUS_LABEL duplicates. Report statuses live in
// src/lib/reports/predicates.ts (existing home, translated in place).
import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

export const WORK_PACKAGE_STATUS_LABEL: Record<Enums["work_package_status"], string> = {
  not_started: "ยังไม่เริ่ม",
  in_progress: "กำลังดำเนินการ",
  on_hold: "พักชั่วคราว",
  complete: "เสร็จสิ้น",
  pending_approval: "รออนุมัติ",
};

export const PROJECT_STATUS_LABEL: Record<Enums["project_status"], string> = {
  active: "กำลังดำเนินการ",
  on_hold: "พักชั่วคราว",
  completed: "เสร็จสิ้น",
  archived: "เก็บถาวร",
};

export const PURCHASE_REQUEST_STATUS_LABEL: Record<Enums["purchase_request_status"], string> = {
  requested: "ส่งคำขอแล้ว",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  purchased: "สั่งซื้อแล้ว",
  delivered: "ได้รับของแล้ว",
};

// Display labels only — the photo_phase enum and storage paths keep
// before/during/after (spec 10 item 3 established the relabel seam).
export const PHOTO_PHASE_LABEL: Record<Enums["photo_phase"], string> = {
  before: "เตรียมงาน",
  during: "ระหว่างทำ",
  after: "แล้วเสร็จ",
};

export const APPROVAL_DECISION_LABEL: Record<Enums["approval_decision"], string> = {
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  needs_revision: "ให้แก้ไข",
};

export const USER_ROLE_LABEL: Record<Enums["user_role"], string> = {
  site_admin: "ผู้ดูแลหน้างาน",
  project_manager: "ผู้จัดการโครงการ",
  super_admin: "ซูเปอร์แอดมิน",
  project_coordinator: "ผู้ประสานงานโครงการ",
  procurement: "ฝ่ายจัดซื้อ",
  technician: "ช่างเทคนิค",
  hr: "ฝ่ายบุคคล",
  subcon_manager: "ผู้จัดการผู้รับเหมาช่วง",
  accounting: "ฝ่ายบัญชี",
  visitor: "ผู้เยี่ยมชม",
};

// One date-time formatter for the whole UI: Thai Buddhist era (what Thai
// users read everywhere), pinned to Asia/Bangkok so a server render and
// a client render of the same instant produce the same string — the two
// previous per-file formatters used the host's default locale/timezone
// and disagreed between server and browser.
const THAI_DATE_TIME = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

export function formatThaiDateTime(iso: string): string {
  const d = new Date(iso);
  // Intl.format throws RangeError on Invalid Date; degrade to the raw
  // string instead (same failure mode as the formatters this replaced).
  if (Number.isNaN(d.getTime())) return iso;
  return THAI_DATE_TIME.format(d);
}

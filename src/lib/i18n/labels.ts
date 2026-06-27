// Thai display labels for every user-facing enum (spec 14). Enum values
// are storage keys; the label is presentation (spec 10 doctrine) — these
// maps are the single place screen code looks labels up, replacing the
// per-file STATUS_LABEL duplicates. Report statuses live in
// src/lib/reports/predicates.ts (existing home, translated in place).
import type { Database } from "@/lib/db/database.types";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import type { PurchaseReasonCode } from "@/lib/purchasing/reason-code";

type Enums = Database["public"]["Enums"];

// Spec 159 U1 — the subcontractor (contractor_category='contractor'): a firm PRC
// hires that pays its OWN crew, distinct from DC (whom PRC pays directly daily)
// and from the general WP "ผู้รับเหมา" (which may be either — left generic on
// purpose). Single-sourced so the term never drifts; derive variants by
// composition (`ชื่อ${SUBCONTRACTOR_LABEL}` etc.). See prc-ops-pay-model.
export const SUBCONTRACTOR_LABEL = "ผู้รับเหมาช่วง";

// Spec 207 — a project work-category (หมวดงาน): the per-project trade/scope
// taxonomy a WP belongs to (exactly one). Distinct from งวดงาน (deliverable,
// billing milestone) and ประเภทโครงการ (project_type). Single-sourced (used on
// the project category manager + the WP control + drawings); the operator-
// authored category `name` is its own label — only this term constant is SSOT'd.
export const PROJECT_CATEGORY_LABEL = "หมวดงาน";

export const WORK_PACKAGE_STATUS_LABEL: Record<Enums["work_package_status"], string> = {
  not_started: "ยังไม่เริ่ม",
  in_progress: "กำลังดำเนินการ",
  on_hold: "พักชั่วคราว",
  complete: "เสร็จสิ้น",
  pending_approval: "รออนุมัติ",
  // Spec 144: a complete WP reopened for a defect.
  rework: "งานแก้ไข",
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
  cancelled: "ยกเลิกแล้ว",
  purchased: "สั่งซื้อแล้ว",
  on_route: "กำลังจัดส่ง",
  delivered: "ได้รับของแล้ว",
  site_purchased: "ซื้อหน้างาน",
};

// Spec 175 — the item catalog (on-site storage / inventory foundation). Single
// source for the catalog term + category labels; item_category enum values are
// storage keys, these are presentation. base_item carries identity, not location.
// Key order matches the item_category enum declaration so iterating the record
// yields the canonical section order.
export const CATALOG_LABEL = "ทะเบียนวัสดุ";

export const ITEM_CATEGORY_LABEL: Record<Enums["item_category"], string> = {
  steel_fixing: "เหล็ก / อุปกรณ์ยึด",
  plumbing_sanitary: "ประปา / สุขภัณฑ์",
  site_safety: "ความปลอดภัย / หน้างาน",
  roofing: "หลังคา / ครอบ",
  ceiling_tile: "ฝ้า / กระเบื้อง",
  electrical: "ไฟฟ้า",
  door_fire: "ประตู / งานหนีไฟ",
  paint: "สี",
  masonry_tools: "เครื่องมืองานปูน",
  machinery_tools: "เครื่องจักร / เครื่องมือ",
  paving: "อิฐทางเท้า",
  tank_septic: "ถังบำบัด / ถังน้ำ",
  custom_fabrication: "งานสั่งทำ",
};

// Spec 177 — the on-site store (stock on hand) + the stock-in (รับเข้า) /
// issue-out (เบิก) actions.
// Spec 197 U1: the store became a per-project destination (a project sub-route +
// header chip, like ตารางงาน). Its term is คลัง — single-sourced here for the
// chip, the sub-route header, and the bottom-tab match.
export const STORE_LABEL = "คลัง";
export const STORE_RECEIVE_LABEL = "รับเข้าสต๊อก";
export const STORE_ISSUE_LABEL = "เบิกออก";

// Spec 209 — two DISTINCT actions that the ambiguous "กลับรายการ" used to conflate
// (operator 2026-06-27). Single-sourced here so the button term can't drift again:
//  - the mistake-undo (reverse_stock_*): correcting a WRONG entry, not a return;
//  - the real WP→store return (return_stock_to_store): material physically back.
export const STORE_FIX_WRONG_ENTRY_LABEL = "แก้รายการที่บันทึกผิด";
export const STORE_RETURN_TO_STORE_LABEL = "คืนเข้าสโตร์";

// Spec 178 — the store margin layer: the per-item SELL price (transfer price).
export const ITEM_SELL_RATE_LABEL = "ราคาขาย";
export const SET_ITEM_SELL_RATE_LABEL = "ตั้งราคาขาย";
export const STORE_PNL_LABEL = "กำไร-ขาดทุนสโตร์";
// Spec 202 U1 — the per-item equipment charge-out rate (money; back-office only).
export const EQUIPMENT_DAILY_RATE_LABEL = "ค่าเช่า/วัน";
export const EQUIPMENT_SET_DAILY_RATE_LABEL = "ตั้งค่าเช่า/วัน";
// Spec 205 — the per-WP labor budget (a money cost ceiling, PM/PD-set; PM review only).
export const LABOR_BUDGET_LABEL = "งบค่าแรง";
export const SET_LABOR_BUDGET_LABEL = "ตั้งงบค่าแรง";
export const EDIT_LABOR_BUDGET_LABEL = "แก้งบค่าแรง";
export const LABOR_BUDGET_USED_LABEL = "ใช้ไป";
export const LABOR_BUDGET_REMAINING_LABEL = "คงเหลือ";
export const LABOR_BUDGET_OVER_LABEL = "เกินงบ";
export const LABOR_BUDGET_UNSET_LABEL = "ยังไม่ได้ตั้งงบค่าแรง";

// Spec 202 U2 — the WP equipment check-out/check-in tab (rate-free field surface).
export const EQUIPMENT_TAB_LABEL = "อุปกรณ์";
export const EQUIPMENT_CHECK_OUT_LABEL = "เช็คเอาท์";
export const EQUIPMENT_CHECK_IN_LABEL = "คืน";
export const EQUIPMENT_IN_USE_LABEL = "กำลังใช้งาน";
// Spec 197 U2 — the full-stocktake action on the per-project คลัง page (the
// relocated /stock-count count-list, opened as a deliberate count-everything pass
// alongside the per-row spot count). The spec-178-B2 standalone STOCK_COUNT_LABEL
// is retired with its /stock-count route.
export const FULL_STOCKTAKE_LABEL = "ตรวจนับทั้งคลัง";

// Spec 134 / ADR 0044 — derived PO roll-up status (not a DB enum; the union
// lives in src/lib/purchasing/purchase-order.ts). open never shows for a live PO
// (members are 'purchased' at creation) but is reachable if every member is later
// cancelled, so it carries a label.
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  open: "ยังไม่สั่งซื้อ",
  // Spec 211 U1: order-scoped wording, distinct from the line-level PR labels
  // (PR purchased="สั่งซื้อแล้ว", on_route="กำลังจัดส่ง"). A PO has no status column —
  // its roll-up is derived from member PRs — so without this split the order pill and
  // a line pill on the PO detail read identically. Guarded in i18n-labels.test.ts.
  ordered: "ออกใบสั่งซื้อแล้ว",
  in_transit: "กำลังจัดส่งทั้งใบ",
  partially_received: "รับของบางส่วน",
  received: "รับของครบแล้ว",
};

// Spec 134 U9 — single source for the PO delivery-proof copy. The section sub-label,
// the upload button, and the empty state all derive from this ONE term so it can't
// drift (the รับของ→จัดส่ง button straggler that prompted this — shotgun surgery).
export const PROOF_OF_DELIVERY_LABEL = "หลักฐานการจัดส่ง";

// Requester-set urgency (spec 16 addendum A2).
export const PURCHASE_REQUEST_PRIORITY_LABEL: Record<Enums["purchase_request_priority"], string> = {
  normal: "ปกติ",
  urgent: "ด่วน",
  critical: "ด่วนมาก",
};

// Spec 176 U4 — the reactive-PR reason code (why the request wasn't drawn from
// the supply plan). Keyed by the local PurchaseReasonCode union (the SSOT in
// reason-code.ts); key order is the canonical UI order. Only `unplanned_miss`
// counts against the PM in U5's accuracy measure.
export const PURCHASE_REQUEST_REASON_CODE_LABEL: Record<PurchaseReasonCode, string> = {
  unplanned_miss: "วางแผนตกหล่น",
  rework: "งานแก้ไข",
  breakage: "ของชำรุด/เสียหาย",
  scope_change: "ขอบเขตงานเปลี่ยน",
  unforeseeable: "เหตุสุดวิสัย",
};

// Display labels only — the photo_phase enum and storage paths keep
// before/during/after (spec 10 item 3 established the relabel seam).
export const PHOTO_PHASE_LABEL: Record<Enums["photo_phase"], string> = {
  before: "เตรียมงาน",
  during: "ระหว่างทำ",
  after: "แล้วเสร็จ",
};

// Spec 141 U4 — equipment movement kinds (the append-only custody log, ADR
// 0055 §4). Single-sourced here because the move-form kind picker and the
// where-is-it badge both render them. 'deployed' composes with a project name in
// equipmentLocationLabel (src/lib/equipment/equipment-location-label.ts); the
// bare label is the fallback when the project name is unavailable.
export const EQUIPMENT_MOVEMENT_KIND_LABEL: Record<Enums["equipment_movement_kind"], string> = {
  received: "รับเข้าคลัง",
  deployed: "หน้างาน",
  returned: "คืนเจ้าของ",
  maintenance: "ซ่อมบำรุง",
  lost: "สูญหาย",
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
  contractor: "ผู้รับเหมา (DC)",
  // Spec 152 / ADR 0058: no Thai label requested by the operator for this role.
  project_director: "Project Director",
};

// Spec 193 U3 — feedback type + triage-status labels for the super_admin review
// list. (The form's segmented toggle uses verb phrases — แจ้งปัญหา / ขอฟีเจอร์;
// these are the short NOUN badges the backlog list shows.)
export const FEEDBACK_TYPE_LABEL: Record<Enums["feedback_type"], string> = {
  bug: "ปัญหา",
  feature: "ฟีเจอร์",
};

export const FEEDBACK_STATUS_LABEL: Record<Enums["feedback_status"], string> = {
  open: "ใหม่",
  in_progress: "กำลังดำเนินการ",
  done: "เสร็จแล้ว",
  declined: "ปฏิเสธ",
};

// Spec 201 U2 — who authored a thread message. 'operator' = the PRC team/CC reply
// channel; 'reporter' = the person who filed the report; 'agent' = a CC-drafted
// reply (arrives in U4).
export const FEEDBACK_AUTHOR_LABEL: Record<Enums["feedback_author_kind"], string> = {
  reporter: "ผู้แจ้ง",
  operator: "ทีมงาน",
  agent: "ผู้ช่วย AI",
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

// Date-only sibling for `date` columns (needed_by, eta — spec 16):
// formatThaiDateTime would render a phantom 00:00. Same era/zone pins,
// same raw-string degradation.
const THAI_DATE = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Bangkok",
});

export function formatThaiDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return THAI_DATE.format(d);
}

// Time-only sibling (spec 54 photo-tile overlays + last-updated lines).
// 24h HH:MM — Thai users read clock time, not the Buddhist-era date.
// Same zone pin and raw-string degradation as the two formatters above.
const THAI_TIME = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Bangkok",
});

export function formatThaiTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return THAI_TIME.format(d);
}

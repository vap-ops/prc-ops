// Thai display labels for every user-facing enum (spec 14). Enum values
// are storage keys; the label is presentation (spec 10 doctrine) — these
// maps are the single place screen code looks labels up, replacing the
// per-file STATUS_LABEL duplicates. Report statuses live in
// src/lib/reports/predicates.ts (existing home, translated in place).
import type { Database } from "@/lib/db/database.types";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import type { PurchaseReasonCode } from "@/lib/purchasing/reason-code";
import type { FrictionEventType } from "@/lib/telemetry/session";

type Enums = Database["public"]["Enums"];

// Spec 159 U1 — the subcontractor (contractor_category='contractor'): a firm PRC
// hires that pays its OWN crew, distinct from DC (whom PRC pays directly daily)
// and from the general WP "ผู้รับเหมา" (which may be either — left generic on
// purpose). Single-sourced so the term never drifts; derive variants by
// composition (`ชื่อ${SUBCONTRACTOR_LABEL}` etc.). See prc-ops-pay-model.
export const SUBCONTRACTOR_LABEL = "ผู้รับเหมาช่วง";

// Feedback bc6df601 — neutral fallback shown when a display name can't be
// resolved from its id (e.g. a role that can't read `public.clients` sees a
// project's client but not its name). The UI must NEVER echo the raw id/UUID;
// resolve names through displayName() (src/lib/i18n/display-name.ts) so this is
// the single fallback. Distinct from WORK_CATEGORY_UNSET_LABEL / "ไม่ระบุลูกค้า"
// (which mean "no value set", not "value present but name unresolved").
export const UNKNOWN_NAME_LABEL = "ไม่ทราบชื่อ";

// Spec 207 — a project work-category (หมวดงาน): the per-project trade/scope
// taxonomy a WP belongs to (exactly one). Distinct from งวดงาน (deliverable,
// billing milestone) and ประเภทโครงการ (project_type). Single-sourced (used on
// the project category manager + the WP control + drawings); the operator-
// authored category `name` is its own label — only this term constant is SSOT'd.
export const PROJECT_CATEGORY_LABEL = "หมวดงาน";

// Spec 229 (ADR 0066 / S8) — the relevance flag a scoped picker shows on an item
// that falls in the WP work-category's material scope (Relation R). Used by the
// PR/supply-plan catalog picker AND the เบิก on-hand select → SSOT here.
export const WORK_CATEGORY_MATCH_LABEL = "ตรงกับงาน";
// Spec 229 — the nudge when a WP is not yet bound to a หมวดงาน. Used by the WP
// work-category badge AND the WpCategoryControl select → SSOT here.
export const WORK_CATEGORY_UNSET_LABEL = "ยังไม่ระบุหมวดงาน";

export const WORK_PACKAGE_STATUS_LABEL: Record<Enums["work_package_status"], string> = {
  not_started: "ยังไม่เริ่ม",
  in_progress: "กำลังดำเนินการ",
  on_hold: "พักชั่วคราว",
  complete: "เสร็จสิ้น",
  pending_approval: "รออนุมัติ",
  // Spec 144: a complete WP reopened for a defect.
  rework: "งานแก้ไข",
};

export const WORK_PACKAGE_PRIORITY_LABEL: Record<Enums["work_package_priority"], string> = {
  normal: "ปกติ",
  urgent: "เร่งด่วน",
  critical: "วิกฤต",
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

// Spec 219 — the modelled subcategory level under each item_category. Term SSOT
// for the manage screen, the cascading picker on the item form, and (U3) the
// drill filter. SUBCATEGORY = the named sub level; MANAGE = the /catalog drill.
export const CATALOG_SUBCATEGORY_LABEL = "หมวดย่อย";
export const MANAGE_SUBCATEGORIES_LABEL = "จัดการหมวดย่อย";

// Spec 221 — the managed MAIN category (catalog_categories). Term SSOT for the
// taxonomy manage screen + the U3 add/edit-category controls.
export const CATALOG_CATEGORY_LABEL = "หมวดหลัก";
export const MANAGE_TAXONOMY_LABEL = "จัดการหมวดหมู่";

// Spec 245 U4 — ordering-plan templates (เทมเพลตแผนจัดหา): the 2 seeded
// qty-only TFM templates, edited at /settings/ordering-templates. Term SSOT for
// the settings-hub link, the list page title, and the editor's back label.
// "เทมเพลต" matches the clone button's wording on the supply-plan page (U2).
export const ORDERING_TEMPLATES_LABEL = "เทมเพลตแผนจัดหา";

// Spec 237 (ADR 0066 S10) — BOQ templates (แม่แบบ BOQ): firm-wide reusable
// estimate templates + their priced lines. Term SSOT for the manage screen, the
// /catalog discoverability link, the line table headers, and the totals. The
// variation_type/line_status enum option labels are presentation for the form.
export const BOQ_TEMPLATES_LABEL = "แม่แบบ BOQ";
export const MANAGE_BOQ_TEMPLATES_LABEL = "จัดการแม่แบบ BOQ";
export const BOQ_LINE_LABEL = "รายการ";
export const BOQ_LINE_TOTAL_LABEL = "รวมรายการ";
export const BOQ_TEMPLATE_TOTAL_LABEL = "รวมทั้งหมด";
export const BOQ_MATERIAL_RATE_LABEL = "ค่าวัสดุ/หน่วย";
export const BOQ_LABOR_RATE_LABEL = "ค่าแรง/หน่วย";
export const BOQ_VARIATION_TYPE_LABEL = "ประเภทรายการ";
export const BOQ_STANDARD_LABEL = "รายการมาตรฐาน";
export const BOQ_EXCLUSIVITY_GROUP_LABEL = "กลุ่มทางเลือก (ถ้ามี)";
export const BOQ_FREE_TEXT_ITEM_LABEL = "รายการอิสระ (ไม่ผูกวัสดุ)";

export const BOQ_VARIATION_TYPE_OPTION_LABEL: Record<Enums["boq_variation_type"], string> = {
  standard: "มาตรฐาน",
  added: "เพิ่มเติม",
  omitted: "ตัดออก",
  provisional_sum: "เผื่อเลือก (Provisional Sum)",
};

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

// Spec 224 (ADR 0066 D3) — the catalog item FACETS. Term SSOT for the item-form
// controls (and any later facet readers). `kind` = what class of thing it is;
// `fulfillment_mode` = how it is sourced (stockable derives from this).
export const ITEM_KIND_LABEL = "ประเภทรายการ";
export const FULFILLMENT_MODE_LABEL = "การจัดหา";
export const OWNER_SUPPLIED_LABEL = "เจ้าของโครงการจัดหาเอง";

export const ITEM_KIND_OPTION_LABEL: Record<Enums["catalog_item_kind"], string> = {
  material: "วัสดุ",
  tool: "เครื่องมือ",
  equipment: "ครุภัณฑ์",
  labor: "ค่าแรง",
  service: "บริการ",
  softcost: "ค่าใช้จ่ายแฝง",
  // Spec 238 (ADR 0066 D7) — an assembly/ชุด: a priced item with an optional BOM.
  assembly: "ชุดประกอบ",
};

export const FULFILLMENT_MODE_OPTION_LABEL: Record<Enums["catalog_fulfillment_mode"], string> = {
  off_shelf: "มีขายทั่วไป",
  made_to_order: "สั่งทำ",
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
export const STORE_RETURN_TO_STORE_LABEL = "คืนเข้าคลัง";

// Spec 213 — the per-material activity log (ประวัติวัสดุ). STOCK_COUNT_LABEL
// single-sources the count verb already used inline across the store surfaces.
export const MATERIAL_LOG_LABEL = "ประวัติวัสดุ";
export const STOCK_COUNT_LABEL = "ตรวจนับ";

// Spec 214 — the structured 6-digit product code (main 2 + sub 2 + sequence 2).
export const PRODUCT_CODE_LABEL = "รหัสสินค้า";

// Feedback 8bb3dc63 — people reached for ตรวจนับ (recount) to "fix" a เบิก they
// recorded with the wrong qty, expecting the cost to reverse; it didn't, because
// a recount reconciles the on-hand NUMBER to physical truth, it is not an
// entry-undo. This hint sits in the count sheet and redirects them to the real
// tool — the issue-undo (STORE_FIX_WRONG_ENTRY_LABEL) lives on the WP page
// (spec 210). Single-sourced so both count sheets (store-manager +
// store-count-manager) stay in step and the action term can't drift.
export const STOCK_COUNT_NOT_UNDO_HINT = `การตรวจนับใช้ปรับยอดให้ตรงของจริงเท่านั้น ไม่ใช่การแก้รายการเบิกที่บันทึกผิด — ถ้าบันทึกเบิกผิด ให้เปิดหน้างาน (WP) ของรายการนั้น แล้วกด “${STORE_FIX_WRONG_ENTRY_LABEL}” ค่าใช้จ่ายจึงจะถูกคืน`;

// Spec 178 — the store margin layer: the per-item SELL price (transfer price).
export const ITEM_SELL_RATE_LABEL = "ราคาขาย";
export const SET_ITEM_SELL_RATE_LABEL = "ตั้งราคาขาย";
export const STORE_PNL_LABEL = "กำไร-ขาดทุนคลัง";
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

// Spec 211 U10b — ONE term for a record's expected-arrival date, shown on the
// worklist grid (was English "ETA"), the review drawer (was "คาดว่าจะได้รับ") and the
// PO group card (was "กำหนดรับของ"). Display label; the set-the-date form inputs keep
// their own "คาดว่าจะได้รับของ" prompt.
export const ETA_LABEL = "กำหนดรับของ";

// Feedback a4e37ccd — "รับของ" read ambiguous (receive from the shop vs receive at
// the site). Operator decision 2026-07-02 + store-first doctrine (ADR 0065 / spec
// 208): goods reaching the site ALWAYS land in the project store (คลัง) — the
// stock-in trigger does exactly that for a store-bound PR — so the receive ACTION
// is named as stock-into-store. Used by the PO receive checklist (header + submit)
// and the PO stepper's received stage. Date/needed-by labels keep "รับของ" (they
// name a date, not the action).
export const RECEIVE_TO_STORE_LABEL = "รับเข้าคลัง";

// Spec 211 U10d — ONE label for the create-purchase-order action (was "สร้าง PO" /
// "สร้างใบสั่งซื้อ (PO)" across the bundle bar, drawer, sheet title, single-PR button
// and price-comparison). Drops the bare English "PO".
export const CREATE_PO_LABEL = "สร้างใบสั่งซื้อ";

// Spec 134 U9 — single source for the PO delivery-proof copy. The section sub-label,
// the upload button, and the empty state all derive from this ONE term so it can't
// drift (the รับของ→จัดส่ง button straggler that prompted this — shotgun surgery).
export const PROOF_OF_DELIVERY_LABEL = "หลักฐานการจัดส่ง";

// Spec 260 — PO-level charges (ค่าใช้จ่ายระดับใบสั่งซื้อ): transport / discount /
// other, plus the charges-aware grand total. One home for these user-facing terms
// (UI-term SSOT) — the create sheet, the PO-detail charges block, and any report
// read from the same strings.
export const PO_CHARGE_TYPE_LABEL: Record<Enums["po_charge_type"], string> = {
  transport: "ค่าขนส่ง",
  discount: "ส่วนลด",
  other: "ค่าใช้จ่ายอื่น",
};
export const PO_CHARGES_SECTION_LABEL = "ค่าใช้จ่ายระดับใบสั่งซื้อ";
export const PO_GRAND_TOTAL_LABEL = "ยอดรวมใบสั่งซื้อ";
export const ADD_PO_CHARGE_LABEL = "เพิ่มค่าใช้จ่าย";

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
  // Feedback 0fa23307 — completion photos for a WP's rework (defect fix),
  // distinct from the original "แล้วเสร็จ" work photos.
  after_fix: "หลังแก้ไข",
  // Spec 248 — the PM's photos of the defect itself (attached when filing
  // รายงานข้อบกพร่อง); each is answered by an after_fix photo from the same angle.
  defect: "จุดบกพร่อง",
};

// Spec 217 — who called a rework round: internal QA/SA vs the client.
export const REWORK_SOURCE_LABEL: Record<Enums["rework_source"], string> = {
  internal: "ตรวจภายใน",
  client: "ลูกค้าแจ้ง",
};

// Optional-source → label (or null when absent, e.g. a legacy reopen). Keeps the
// per-round heading + banner call sites tidy.
export function reworkSourceLabel(
  source: Enums["rework_source"] | null | undefined,
): string | null {
  return source ? REWORK_SOURCE_LABEL[source] : null;
}

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
  // Spec 261 / ADR 0070: the procurement dept manager (หัวหน้าจัดซื้อ). Load-bearing —
  // the user-admin role picker renders Object.entries(USER_ROLE_LABEL), so this entry
  // is what makes the "promote to procurement_manager" option appear.
  procurement_manager: "หัวหน้าจัดซื้อ",
  technician: "ช่างเทคนิค",
  hr: "ฝ่ายบุคคล",
  subcon_manager: "ผู้จัดการผู้รับเหมาช่วง",
  accounting: "ฝ่ายบัญชี",
  visitor: "ผู้เยี่ยมชม",
  contractor: "ผู้รับเหมา (DC)",
  // Spec 152 / ADR 0058: no Thai label requested by the operator for this role.
  project_director: "Project Director",
  // Spec 233 / ADR 0067: the external read-only client/customer audience.
  client: "ลูกค้า",
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

// Spec 244 U5 — short Thai chip labels for the friction event types (ADR 0068
// Tier B). Used by the friction map AND the per-person timeline, so they live
// here (ui-term-consistency: any user-facing term on 2+ surfaces is
// single-sourced).
export const FRICTION_EVENT_LABEL: Record<FrictionEventType, string> = {
  js_error: "error",
  upload_fail: "อัปโหลดไม่ได้",
  validation_error: "กรอกไม่ผ่าน",
  form_abandon: "ทิ้งฟอร์ม",
  rage_tap: "กดรัว",
};

// Spec 249 — how client money arrived (also reused by spec 251 subcon payments).
export const RECEIPT_METHOD_LABEL: Record<Enums["receipt_method"], string> = {
  bank_transfer: "โอนธนาคาร",
  cheque: "เช็ค",
  cash: "เงินสด",
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

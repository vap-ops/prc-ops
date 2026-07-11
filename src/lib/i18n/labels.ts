// Thai display labels for every user-facing enum (spec 14). Enum values
// are storage keys; the label is presentation (spec 10 doctrine) — these
// maps are the single place screen code looks labels up, replacing the
// per-file STATUS_LABEL duplicates. Report statuses live in
// src/lib/reports/predicates.ts (existing home, translated in place).
import type { Database } from "@/lib/db/database.types";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import type { PurchaseReasonCode } from "@/lib/purchasing/reason-code";
import type { IncomingLens } from "@/lib/purchasing/request-bands";
import type { FrictionEventType } from "@/lib/telemetry/session";

type Enums = Database["public"]["Enums"];

// Spec 159 U1 / spec 266 — the subcontractor (contractor_category='contractor'): a
// firm PRC hires that pays its OWN crew, distinct from a directly-hired ช่าง (whom
// PRC pays directly, daily) and from the general WP "ผู้รับเหมา" (which may be
// either — left generic on purpose). Single-sourced so the term never drifts;
// derive variants by composition (`ชื่อ${SUBCONTRACTOR_LABEL}` etc.). See prc-ops-pay-model.
export const SUBCONTRACTOR_LABEL = "ผู้รับเหมาช่วง";

// Spec 266 (ADR 0073) — the merged worker identity. An individual directly-hired
// field person is a ช่าง; the group / menu term is ทีมช่าง. SSOT so the merged
// vocabulary can't drift back to "DC" / "ทีมงาน" (ui-term-consistency doctrine).
export const WORKER_LABEL = "ช่าง";
export const WORKER_TEAM_LABEL = "ทีมช่าง";

// Feedback bc6df601 — neutral fallback shown when a display name can't be
// resolved from its id (e.g. a role that can't read `public.clients` sees a
// project's client but not its name). The UI must NEVER echo the raw id/UUID;
// resolve names through displayName() (src/lib/i18n/display-name.ts) so this is
// the single fallback. Distinct from WORK_CATEGORY_UNSET_LABEL / "ไม่ระบุลูกค้า"
// (which mean "no value set", not "value present but name unresolved").
export const UNKNOWN_NAME_LABEL = "ไม่ทราบชื่อ";

// Spec 270 (ADR 0074 D2) — the two-level work-package vocabulary. The parent
// grouping row takes the plain term งาน; the leaf rows (where photos, money,
// status edits live) are งานย่อย. Any surface that names either level reads
// these constants (ui-term-consistency doctrine) so the pair can never drift.
export const WP_GROUP_LABEL = "งาน";
export const WP_LEAF_LABEL = "งานย่อย";

// Spec 273 (ADR 0076) — the SA next-day work board. แผนพรุ่งนี้ is the board's
// name (the tomorrow list of งานย่อย the crew will run). ผู้รับผิดชอบงานย่อย marks
// the one crew member accountable for a งานย่อย on the board (schema:
// daily_work_plan_crew.is_lead; flexible per-leaf crew, no team entity in v1).
// Scoped to งานย่อย on purpose — a bare ผู้รับผิดชอบ already means the PROJECT lead
// elsewhere (project-info-button / settings), so the งานย่อย suffix disambiguates
// (and keeps it distinct from spec-271's งาน-level owner). SSOT'd so the board UI
// (U2) and the morning worklist (U3) can't drift. Button microcopy (มาทำ /
// ทั้งหมดมาทำ / เพิ่ม+งานย่อย) is composed where used.
export const DAILY_WORK_PLAN_LABEL = "แผนพรุ่งนี้";
export const SUBWP_RESPONSIBLE_LABEL = "ผู้รับผิดชอบงานย่อย";
// Spec 273 U5 — relative-day qualifiers for the date-navigable board stepper (and
// the /sa "แก้ไขแผนวันนี้" deep-link). SSOT'd because both surfaces use them.
export const TODAY_LABEL = "วันนี้";
export const TOMORROW_LABEL = "พรุ่งนี้";

// Spec 281 U2 — the แนะนำแผนพรุ่งนี้ recommender surface on /sa/plan: a draft board
// the SA reviews (every row + crew pre-checked, D4) then commits with ใช้ที่เลือก via
// the existing 273 RPCs. SSOT'd — the trigger and the draft rows share the wording.
export const SUGGEST_PLAN_LABEL = "แนะนำแผนพรุ่งนี้";
export const APPLY_SELECTED_LABEL = "ใช้ที่เลือก";
export const CLEAR_CREW_LABEL = "ล้างทีม";
export const PICK_CREW_SELF_LABEL = "เลือกทีมเอง";

// Spec 282 U2 — the SA site team board: on-site headcount split into team-nature
// buckets + a site-access bucket, with per-member cross-charge exception badges
// (approach A). SSOT'd — the board + its badges are the only users.
export const SITE_HEADCOUNT_LABEL = "คนหน้างาน";
export const TEAM_INTERNAL_LABEL = "ทีมภายใน";
export const TEAM_EXTERNAL_LABEL = "ทีมภายนอก";
export const SITE_ACCESS_LABEL = "ฝ่ายไซต์";
export const UNASSIGNED_TEAM_LABEL = "ยังไม่ได้จัดทีม";
export const EXCEPTION_OUR_TECH_EXTERNAL_LABEL = "ช่างเราในทีมนอก";
export const EXCEPTION_SUBCON_INTERNAL_LABEL = "ช่างนอกในทีมเรา";

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
// Spec 297 — the negative counterpart of WORK_CATEGORY_MATCH_LABEL: the passive
// flag shown on a scoped-picker row (via แสดงทั้งหมด) or the selected item when
// it falls OUTSIDE the WP work-category's material scope. Never blocks the pick.
export const WORK_CATEGORY_MISMATCH_LABEL = "นอกหมวดงาน";
export const WORK_CATEGORY_MISMATCH_WARNING =
  "วัสดุนี้ไม่อยู่ในหมวดงานของงานนี้ — เลือกได้ แต่โปรดตรวจสอบ";
// Spec 229 — the nudge when a WP is not yet bound to a หมวดงาน. Used by the WP
// work-category badge AND the WpCategoryControl select → SSOT here.
export const WORK_CATEGORY_UNSET_LABEL = "ยังไม่ระบุหมวดงาน";

// Spec 264 follow-up (site assignment at approval) — the OPTIONAL project
// picker beside the role selector on the staff-registration approval detail.
// The RPC only honors p_project_id for a FIELD role (workers.project_id); the
// selector itself is shown unconditionally (harmless no-op for office roles) —
// see RegistrationDecision. SSOT so the label/hint/empty-option text never
// drifts between the selector and any future surface that reads it.
export const REGISTRATION_SITE_ASSIGN_LABEL = "มอบหมายให้ไซต์งาน (ถ้ามี)";
export const REGISTRATION_SITE_ASSIGN_HINT =
  "เลือกไซต์ที่ช่างคนนี้จะไปประจำ — เว้นว่างได้ถ้ายังไม่ทราบ";
export const REGISTRATION_SITE_ASSIGN_EMPTY_OPTION = "— ไม่ระบุไซต์งาน (ถ้ามี) —";

// Spec 279 F2b — the applicant scanned a specific SA's per-project QR; the
// approval detail shows who invited them (เชิญโดย: <SA>) as advisory context.
export const REGISTRATION_INVITED_BY_LABEL = "เชิญโดย";

// Spec 292 U4 — SA current-site switcher (chip + sheet on /sa) + the PM's
// set-primary control on project settings. SSOT'd: ตั้งเป็นไซต์หลัก (pin) and
// ไซต์หลัก (the primary marker) render on BOTH the SA sheet AND the PM control;
// ไซต์ปัจจุบัน captions the chip and titles the sheet. Under a derived default the
// chip shows the project name + an อัตโนมัติ hint (locked decision #5); an active
// view-override shows กำลังดู with a กลับไซต์หลัก revert.
export const PRIMARY_SITE_LABEL = "ไซต์หลัก";
export const SET_PRIMARY_SITE_LABEL = "ตั้งเป็นไซต์หลัก";
export const CURRENT_SITE_LABEL = "ไซต์ปัจจุบัน";
export const CURRENT_SITE_AUTO_HINT = "อัตโนมัติ";
export const VIEWING_SITE_LABEL = "กำลังดู";
export const CLEAR_SITE_OVERRIDE_LABEL = "กลับไซต์หลัก";

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

// Spec 277 P1a — the site-issue log (แจ้งปัญหา). Type = the cause of a site problem
// / work pause (the reporter's "what information to put"); status = open → resolved.
export const SITE_ISSUE_TYPE_LABEL: Record<Enums["site_issue_type"], string> = {
  weather: "สภาพอากาศ/ฝน",
  equipment: "เครื่องจักร/อุปกรณ์เสีย",
  safety: "ความปลอดภัย/อุบัติเหตุ",
  access: "เข้าพื้นที่ไม่ได้",
  other: "อื่น ๆ",
};
export const SITE_ISSUE_STATUS_LABEL: Record<Enums["site_issue_status"], string> = {
  open: "เปิดอยู่",
  resolved: "แก้ไขแล้ว",
};
// UI strings for the แจ้งปัญหา surface (SSOT — used by the FAB, the sheet and the section).
export const REPORT_ISSUE_LABEL = "แจ้งปัญหา";
export const TODAY_ISSUES_LABEL = "ปัญหาวันนี้";
export const ISSUE_NOTE_PLACEHOLDER = "รายละเอียดเพิ่มเติม (ถ้ามี)";
export const ISSUE_ADD_PHOTO_LABEL = "เพิ่มรูป";
export const ISSUE_SUBMIT_LABEL = "ส่ง";

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

// Spec 300 U1 — the SA delivery lens over the incoming (กำลังจัดส่ง) band.
export const INCOMING_LENS_LABEL: Record<IncomingLens, string> = {
  today: "วันนี้",
  onroute: "กำลังมา",
  all: "ทั้งหมด",
};

// Spec 300 U2 — the receive card: store-receipt confirmation + receipt-paper prompt.
export const RECEIVED_INTO_STORE_LABEL = "✓ รับเข้าคลังแล้ว";
export const RECEIVED_INTO_STORE_HINT = "รูปยืนยันการรับของบันทึกของเข้าคลังให้อัตโนมัติ";
export const RECEIPT_PAPER_PROMPT = "ใบส่งของ / ใบเสร็จ (ถ้ามากับของ)";

// Spec 285 U3 — the on-site self-purchase (ซื้อเอง) is an EXPENSE: money already
// spent, catalog-only, evidence-required (U1/U2). It gets its own tab, heading,
// submit verb, and list badge so it never reads like a ขอซื้อ (ask-procurement)
// request. Disjoint additive region; no enum change (row stays source='site_purchase').
export const SITE_EXPENSE_TAB_LABEL = "ค่าใช้จ่ายหน้างาน";
export const SITE_EXPENSE_HEADING = "บันทึกค่าใช้จ่าย (จ่ายเงินไปแล้ว)";
export const SITE_EXPENSE_SUBMIT = "บันทึกค่าใช้จ่าย";
export const SITE_EXPENSE_BADGE = "ค่าใช้จ่าย";

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
export const BOQ_TEMPLATE_TOTAL_LABEL = "รวมทั้งหมด";
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
// Spec 268 — the inbound rental-deal recorder (/equipment/rentals; money, back office).
export const EQUIPMENT_RENTAL_LABEL = "เช่าอุปกรณ์";
export const EQUIPMENT_RENTAL_RECORD_LABEL = "บันทึกการเช่า";
export const EQUIPMENT_RATE_PERIOD_LABEL: Record<"monthly" | "daily", string> = {
  monthly: "ต่อเดือน",
  daily: "ต่อวัน",
};
export const EQUIPMENT_RENTAL_WHOLE_PROJECT_LABEL = "ตลอดโครงการ";
export const EQUIPMENT_RENTAL_CUSTOM_PERIOD_LABEL = "กำหนดช่วงเอง";
export const EQUIPMENT_RENTAL_ALLOCATE_LABEL = "ผูกโครงการ";
// Spec 275 U1 — agreement terms on the rental deal (deposit + minimum rental days).
export const EQUIPMENT_RENTAL_DEPOSIT_LABEL = "เงินมัดจำ (บาท)";
export const EQUIPMENT_RENTAL_MIN_DAYS_LABEL = "เช่าขั้นต่ำ (วัน)";
// Spec 275 U3 — the rental settlement (vendor invoice) recorder (money, back
// office; /equipment/rentals). base + overtime + fees = net; the deposit is
// resolved separately (refund/forfeit) and never netted into net.
export const RENTAL_SETTLEMENT_RECORD_LABEL = "บันทึกการชำระ";
export const RENTAL_SETTLEMENT_AGREEMENT_LABEL = "สัญญาเช่า";
export const RENTAL_SETTLEMENT_INVOICE_NO_LABEL = "เลขที่ใบแจ้งหนี้";
export const RENTAL_SETTLEMENT_INVOICE_DATE_LABEL = "วันที่ใบแจ้งหนี้";
export const RENTAL_SETTLEMENT_BASE_LABEL = "ค่าเช่า (บาท)";
export const RENTAL_SETTLEMENT_OVERTIME_LABEL = "ค่าล่วงเวลา (บาท)";
export const RENTAL_SETTLEMENT_FEES_LABEL = "ค่าบริการอื่น (บาท)";
export const RENTAL_SETTLEMENT_NET_LABEL = "ยอดสุทธิ";
export const RENTAL_SETTLEMENT_VAT_LABEL = "ภาษีมูลค่าเพิ่ม (บาท)";
export const RENTAL_SETTLEMENT_DEPOSIT_REFUNDED_LABEL = "มัดจำคืน (บาท)";
export const RENTAL_SETTLEMENT_DEPOSIT_FORFEITED_LABEL = "มัดจำริบ (บาท)";
export const RENTAL_SETTLEMENT_METHOD_LABEL = "วิธีชำระ";
export const RENTAL_SETTLEMENT_HISTORY_LABEL = "ประวัติการชำระ";
export const RENTAL_SETTLEMENT_EMPTY_LABEL = "ยังไม่มีการชำระที่บันทึกไว้";
export const RENTAL_SETTLEMENT_CORRECT_LABEL = "แก้ไข";
export const RENTAL_SETTLEMENT_CORRECT_CONFIRM_LABEL = "ยืนยันการแก้ไข";
export const RENTAL_SETTLEMENT_CORRECTION_REASON_LABEL = "เหตุผลการแก้ไข";
// Spec 275 U4 — the rental variance roll-up (read-only, money, back office). Per
// agreement: committed (rate×period estimate) vs charged-to-WP (usage × charge-out)
// vs paid-to-vendor (settlements). The flag compares charged vs paid.
export const RENTAL_VARIANCE_LABEL = "ส่วนต่างค่าเช่า (คิดเข้างาน vs จ่ายจริง)";
export const RENTAL_VARIANCE_COMMITTED_LABEL = "ผูกพันตามสัญญา (ประมาณ)";
export const RENTAL_VARIANCE_CHARGED_LABEL = "คิดเข้างาน (WP)";
export const RENTAL_VARIANCE_PAID_LABEL = "จ่ายผู้ให้เช่า";
export const RENTAL_VARIANCE_EMPTY_LABEL = "ยังไม่มีสัญญาเช่าให้สรุปส่วนต่าง";
export const RENTAL_VARIANCE_FLAG_LABEL: Record<
  "over_recovery" | "under_recovery" | "balanced",
  string
> = {
  over_recovery: "คิดเข้างานมากกว่าจ่าย (กำไร)",
  under_recovery: "คิดเข้างานน้อยกว่าจ่าย (ขาดทุน)",
  balanced: "เท่ากัน",
};
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

// Spec 265 U2 — the super_admin LINE-identity verification block. SSOT strings
// used by the shared LineIdentityBlock across /registrations/[id] and
// /settings/roles/[id].
/** Section heading for the LINE ground-truth identity block. */
export const LINE_IDENTITY_HEADING = "ตัวตน LINE (ยืนยันตัวบุคคล)";
/** Label for the LINE-owned display name (the verification anchor, ≠ full_name). */
export const LINE_DISPLAY_NAME_LABEL = "ชื่อ LINE";
/** Empty state when the user has not logged in since spec 265 U1 shipped. */
export const LINE_IDENTITY_NOT_SYNCED_LABEL = "ยังไม่ได้ซิงค์ (รอผู้ใช้เข้าสู่ระบบครั้งถัดไป)";

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
  // Spec 266 U7 (ADR 0073): a ช่าง's portal login is role `technician` — "ช่าง".
  technician: "ช่าง",
  // Spec 263 / ADR 0071: two behavior-free forward-compat field roles. Labels
  // land here because the user-admin role picker renders Object.entries(USER_ROLE_LABEL);
  // wording is provisional (operator to confirm/adjust).
  site_owner: "เจ้าของไซต์",
  auditor: "ผู้ตรวจสอบ",
  hr: "ฝ่ายบุคคล",
  subcon_manager: "ผู้จัดการผู้รับเหมาช่วง",
  accounting: "ฝ่ายบัญชี",
  // Spec 284 / ADR 0080: the Legal department's auth-role. Lands here so the
  // super_admin user-admin role picker (renders Object.entries(USER_ROLE_LABEL))
  // offers "promote to ฝ่ายกฎหมาย".
  legal: "ฝ่ายกฎหมาย",
  visitor: "ผู้เยี่ยมชม",
  // Spec 266 U7 (ADR 0073): `contractor` is the subcontractor portal only —
  // "ผู้รับเหมา" (the "(DC)" suffix is dropped; ช่าง are `technician` now).
  contractor: "ผู้รับเหมา",
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

// Spec 264 follow-up (Handoff Unit A) — the pending-branch waiting notice on
// /register/technician. Operator: applicants didn't know they were DONE after
// submitting and waiting for approval (the back-office queue already lists
// every pending registration; nothing further is required of the applicant).
// Copy-only fix — no new state.
export const REGISTRATION_PENDING_NOTICE_HEADING = "ส่งใบสมัครแล้ว รอการอนุมัติ";
// Spec 286 U1: role-neutral ("หน้าหลักของคุณเอง", was "หน้าช่างของคุณเอง") — the
// post-submit visitor is redirected to this shared workspace regardless of which
// door (on-site / office) they entered, so the pending copy must not claim ช่าง.
export const REGISTRATION_PENDING_NOTICE_BODY =
  "ทีมงานได้รับใบสมัครของคุณแล้ว ไม่ต้องส่งบัตรให้ใครเพิ่ม เมื่ออนุมัติแล้ว หน้านี้จะกลายเป็นหน้าหลักของคุณเอง — เปิดแอปอีกครั้งเพื่อดูสถานะได้ตลอด";
export function registrationPendingEmployeeIdLine(employeeId: string): string {
  return `รหัสพนักงานของคุณ: ${employeeId} — เก็บไว้อ้างอิง`;
}

// Spec 286 U1 — the two self-onboard door headings. The staff self-registration
// flow is role-neutral (spec 263/264); these label the two entry variants. The
// STATUS heading is the neutral heading shown once a registration exists (the
// pending/rejected view an office applicant is redirected into on the shared
// workspace) — so that view never re-shows the on-site "สมัครเป็นช่าง".
export const REGISTER_FIELD_HEADING = "สมัครเป็นช่าง";
export const REGISTER_OFFICE_HEADING = "สมัครงานสำนักงาน";
export const REGISTER_STATUS_HEADING = "ใบสมัครของคุณ";

// Spec 264 follow-up (Handoff Unit A) — the Web Share/clipboard-fallback
// button on the same page. Operator: the receiving SA had no idea what was
// wanted of them. Demoted to an optional courtesy ("ถ้ามี") and the shared
// payload now tells the SA no action is needed — approval happens in the
// back-office queue, not via this share.
export const SHARE_CARD_BUTTON_LABEL = "แชร์บัตรให้หัวหน้าที่หน้างาน (ถ้ามี)";
export const SHARE_CARD_TITLE = "บัตรพนักงาน PRC (รออนุมัติ)";
export function shareCardText(fullName: string, employeeId: string): string {
  return `${fullName || "ผู้สมัคร"} สมัครเป็นช่างกับ PRC แล้ว รหัส ${employeeId} — กำลังรอทีมงานอนุมัติ ไม่ต้องดำเนินการใด ๆ`;
}

// ---------------------------------------------------------------------------
// Spec 284 U5 / ADR 0080 — Legal department surfaces (/legal). User-facing
// strings for the Legal home, the contracts surface, and the document-approval
// queue. The enum label maps mirror the contract_* / document_decision enums
// (database.types) — the single place the Legal screens look these up.
// ---------------------------------------------------------------------------

/** The Legal department home + nav label. */
export const LEGAL_LABEL = "ฝ่ายกฎหมาย";
/** Contracts surface (list + create + detail). */
export const CONTRACTS_LABEL = "สัญญา";
/** Document-approval queue — contracts awaiting a legal decision. */
export const LEGAL_APPROVALS_LABEL = "เอกสารรออนุมัติ";

export const CONTRACT_STATUS_LABEL: Record<Enums["contract_status"], string> = {
  draft: "ร่าง",
  active: "มีผลบังคับ",
  expired: "หมดอายุ",
  terminated: "สิ้นสุด",
  void: "เป็นโมฆะ",
};

export const CONTRACT_TYPE_LABEL: Record<Enums["contract_type"], string> = {
  client_agreement: "สัญญากับลูกค้า",
  subcontract: "สัญญาช่วง",
  supply: "สัญญาจัดหา",
  nda: "สัญญารักษาความลับ",
  other: "อื่น ๆ",
};

export const CONTRACT_COUNTERPARTY_LABEL: Record<Enums["contract_counterparty_type"], string> = {
  client: "ลูกค้า",
  contractor: "ผู้รับเหมา",
  supplier: "ผู้ขาย",
  other: "อื่น ๆ",
};

export const DOCUMENT_DECISION_LABEL: Record<Enums["document_decision"], string> = {
  approve: "อนุมัติ",
  reject: "ไม่อนุมัติ",
  needs_revision: "ขอแก้ไข",
};

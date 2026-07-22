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

// Spec 313 D4 — the nav-term split: ทีมงาน names ONLY the /team people hub;
// the company roster surface is รายชื่อช่าง; the WP daily labor log is แรงงาน.
export const TEAM_HUB_LABEL = "ทีมงาน";
export const WORKER_ROSTER_LABEL = "รายชื่อช่าง";
export const LABOR_TAB_LABEL = "แรงงาน";

// Spec 332 — worker trades (สายงาน): the assignment axis, tags on W01–W09.
// One home for the roster sheet's trade labels + the message-keyed error map
// (never let a raw set_worker_trades Postgres error reach the user).
export const TRADE_LABEL = "สายงาน";
export const TRADE_PRIMARY_LABEL = "สายงานหลัก";
export const TRADE_PRIMARY_CLEAR_LABEL = "ไม่ระบุสายงานหลัก";
export const TRADES_EMPTY_LABEL = "ยังไม่ระบุสายงาน";
export const TRADE_SAVE_GENERIC_ERROR = "บันทึกสายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
// Keyed on the RPC's raised message (set_worker_trades: <key>).
export const TRADE_ERROR_BY_MESSAGE: Record<string, string> = {
  "role not permitted": "ไม่มีสิทธิ์แก้ไขสายงาน",
  "worker not found": "ไม่พบช่างคนนี้ กรุณารีเฟรชหน้า",
  "invalid category": "หมวดงานไม่ถูกต้อง กรุณารีเฟรชหน้า",
  "primary not in set": "สายงานหลักต้องเป็นหนึ่งในสายงานที่เลือก",
};

// Spec 321 U1 — profile-edit door names. Single-sourced so the canonical
// self-service door ("ข้อมูลของฉัน" = /settings/my-info) and the read-only
// identity card ("โปรไฟล์" = /profile) never drift across the settings hub,
// portals, and coming-soon (S11, session investigation 2026-07-15).
export const MY_INFO_LABEL = "ข้อมูลของฉัน";
export const PROFILE_LABEL = "โปรไฟล์";

// Spec 321 U7 — approved-tier profile-change copy, single-sourced so every
// audience shows one uniform waiting banner + success toast + approver subtitle
// (kills the S16 per-surface divergences). Bank changes route to money
// approvers — a worker's / contractor's to their ผู้จัดการ (PM variant), an
// office/login staffer's to ฝ่ายบุคคล (HR variant); identity (name / national-ID
// / DOB) routes to the staff-approval trio. Consumed by <PendingChangeNotice>,
// ProfileBankSection (via BANK_AUDIENCE), the identity + user-bank forms, and the
// my-info user_bank read section.
export const BANK_CHANGE_PENDING_PM = "คำขอเปลี่ยนบัญชีธนาคารกำลังรอผู้จัดการอนุมัติ";
export const BANK_CHANGE_PENDING_HR = "คำขอเปลี่ยนบัญชีธนาคารกำลังรอการอนุมัติ";
export const BANK_CHANGE_TOAST_PM = "ส่งคำขอแล้ว รอผู้จัดการอนุมัติ";
export const BANK_CHANGE_TOAST_HR = "ส่งคำขอแล้ว รอการอนุมัติ";
export const BANK_CHANGE_APPROVER_PM = "ผู้จัดการจะตรวจสอบก่อนใช้งานจริง";
export const BANK_CHANGE_APPROVER_HR = "ฝ่ายบุคคลจะตรวจสอบก่อนใช้งานจริง";
export const IDENTITY_CHANGE_PENDING = "คำขอแก้ไขข้อมูลตัวตนกำลังรอการอนุมัติ";
export const IDENTITY_CHANGE_TOAST = "ส่งคำขอแล้ว รอการอนุมัติ";

// Spec 321 U8a — the login-keyed (admin/office) user_bank is INSTANT: it saves
// directly, no approval. The subtitle + toast say so (contrast the approved-tier
// BANK_CHANGE_* copy above).
export const BANK_INSTANT_SUBTITLE = "บันทึกและใช้งานได้ทันที";
export const BANK_INSTANT_TOAST = "บันทึกบัญชีธนาคารแล้ว";

// Spec 314 / ADR 0082 — the firm-wide standard day-rate per skill level + WHT.
// PM-maintained (procurement_manager/super_admin); the /settings/labor-rates door.
// (The worker-level Thai labels reuse WORKER_LEVEL_LABEL from src/lib/nova/dials.ts
// — the established SSOT used by the roster/nova/SA surfaces; don't re-declare it.)
export const LABOR_RATES_LABEL = "ค่าแรงมาตรฐาน";
export const LABOR_RATES_HINT = "อัตราค่าแรงมาตรฐานต่อระดับฝีมือ · ภาษีหัก ณ ที่จ่าย";
export const LABOR_RATE_INPUT_LABEL = "อัตรา/วัน (บาท)";
export const LABOR_RATE_GROSS_LABEL = "ค่าแรงเต็ม";
export const LABOR_RATE_UNSET = "ยังไม่กำหนด";
export const LABOR_RATE_SAVE_LABEL = "บันทึก";
export const LABOR_RATE_NUMBER_ERROR = "กรอกเป็นตัวเลขเท่านั้น (ไม่ใส่จุลภาค)";
export const WHT_BASIS_LABEL = "ฐานภาษี";
export const WHT_BASIS_BEFORE_LABEL = "ก่อนหักภาษี";
export const WHT_BASIS_AFTER_LABEL = "หลังหักภาษี";
export const WHT_PCT_LABEL = "ภาษีหัก ณ ที่จ่าย (%)";

// Spec 314 U4 — payroll withholding/net display terms (the /payroll roll-up + the
// per-worker cards). The gross figure is the standalone headline (unlabeled, as the
// pre-314 total was); these two label the WHT/net split beneath it. Single-sourced
// here so the page never drifts; the CSV export pins its own column headers in
// payroll.ts.
export const PAYROLL_WHT_LABEL = "หัก ณ ที่จ่าย";
export const PAYROLL_NET_LABEL = "สุทธิ";

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
// Spec 306 U3 — the morning-talk muster (check-in). SSOT'd because the project
// cockpit CTA, the /projects/[id]/muster page title + header all name it.
export const MUSTER_LABEL = "เช็คชื่อ";
// Spec 334 U1 — the ปิดวันแล้ว banner is now a 2-surface string: the muster cockpit
// (muster-cockpit.tsx) and the /team วันนี้ hero (MusterTodayCard), so it is SSOT'd
// here per the UI-term rule. The card's other strings are single-surface → local.
export const MUSTER_DAY_CLOSED_LABEL = "ปิดวันแล้ว";
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

// Spec 298 U3 — the PM completion queue: workers an SA added phoneless with a
// capture-blind passbook, awaiting a money-authorized approver (STAFF_APPROVAL_ROLES)
// to transcribe the bank into workers.bank_*. Titles /registrations/awaiting-bank + its link.
export const AWAITING_BANK_TITLE = "ช่างรอกรอกบัญชี";

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

// Spec 298 U2 — SA onboarding front door on /sa/crew: one "add new" button opens an
// onboarding sheet branching มีมือถือ (self-serve QR + coaching) / ไม่มีมือถือ
// (capture-blind add: identity + a REQUIRED passbook photo). The bank-pending chip
// marks a roster worker awaiting a PM's bank transcription (spec 298 U3).
export const ADD_TECHNICIAN_LABEL = "เพิ่มช่างใหม่";
export const ADD_TECHNICIAN_HAS_PHONE_LABEL = "มีมือถือ";
export const ADD_TECHNICIAN_NO_PHONE_LABEL = "ไม่มีมือถือ";
export const ADD_TECHNICIAN_HAS_PHONE_HINT =
  "ให้ช่างสแกน QR ของโครงการด้วยมือถือตัวเอง แล้วกรอกข้อมูลและบัญชีธนาคารเอง";
export const ADD_TECHNICIAN_NO_PHONE_HINT =
  "กรอกชื่อ–เลขบัตรประชาชน–วันเกิด แล้วถ่ายรูปหรือแนบรูปสมุดบัญชี (ผู้จัดการจะกรอกเลขบัญชีให้ภายหลัง)";
export const PASSBOOK_PHOTO_LABEL = "รูปสมุดบัญชีธนาคาร";
export const BANK_PENDING_CHIP_LABEL = "รอ PM กรอกบัญชี";

// Spec 328 — subcon-member onboarding: the เพิ่มช่างใหม่ sheet's team selector
// (ทีม PRC = today's pipeline; one row per contractor firm = the bank-free arm)
// + the per-firm QR card and the register-page firm banner.
export const TEAM_JOIN_SELECT_LABEL = "สมัครเข้าทีม";
export const TEAM_PRC_LABEL = "ทีม PRC";
export const TEAM_PRC_HINT = "ช่างบริษัท / ทีมงาน DC";
export const SUBCON_TEAM_HINT = "ทีมผู้รับเหมา — ไม่เก็บข้อมูลธนาคาร";
export const SUBCON_NO_BANK_HINT = "ไม่เก็บข้อมูลธนาคาร";
export const SUBCON_JOIN_PREFIX = "สมัครทีม";
export const SUBCON_POSTER_LABEL = "พิมพ์โปสเตอร์";
export const SUBCON_LINE_SHARE_LABEL = "ส่งลิงก์ทาง LINE";
export const SUBCON_REGISTER_BANNER_HINT =
  "สมัครแบบทีมผู้รับเหมา — ไม่ต้องกรอกบัญชีธนาคาร (บริษัทจ่ายค่างานให้ทีมตามงวดงาน)";

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
export const RECEIPT_PAPER_PROMPT = "ถ่ายรูปใบส่งของ / ใบเสร็จที่มากับของ (ถ้ามี)";
// Spec 302 — ownership-aware document sections on the PR page: provenance
// headings so the SA can tell procurement's paperwork from their own job.
// Spec 304 asymmetry: procurement's docs are BO-only surfaces; the SA never
// sees them. Procurement DOES see every SA-doc gap (the ยังไม่มี flags below).
export const PO_DOCS_FROM_PROCUREMENT_LABEL = "เอกสารจากฝ่ายจัดซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)";
export const INVOICE_PAPER_MISSING_LABEL = "ยังไม่มีใบส่งของ / ใบเสร็จจากหน้างาน";
// Spec 303 — goods-photo integrity: the receive proof is taken live (capture),
// must cover everything received, and pairs with the row's delivered amount.
export const DELIVERY_PHOTO_COVERAGE_HINT = "ถ่ายให้เห็นของที่รับครบทุกรายการ — ถ่ายได้หลายรูป";
export const DELIVERY_PHOTO_MISSING_LABEL = "ยังไม่มีรูปยืนยันการรับของ";
export function deliveredQtyCaption(quantity: number, unit: string): string {
  return `จำนวนที่รับ ${quantity} ${unit}`;
}

// Spec 305 — supplier-unknown fallback on the delivery cards. The same literal
// predates this in 4 money-lib files (load-voucher/purchases/payables/po-list);
// sweeping those onto this constant = follow-up (money paths are danger-gated).
export const UNKNOWN_SUPPLIER_LABEL = "ไม่ระบุผู้ขาย";

// Spec 300 U3 — the store's incoming-delivery section (คลัง & ของเข้า).
export const STORE_INCOMING_HEADING = "ของเข้า";
export const STORE_INCOMING_SUBTITLE = "ของที่กำลังจะเข้าคลัง — กดเพื่อดูและรับของ";
export const STORE_INCOMING_EMPTY = "ไม่มีของกำลังเข้าในตัวกรองนี้";
// Shared across the /requests band + the store ของเข้า section (UI-term SSOT).
export const DELIVERY_LENS_FILTER_ARIA = "ตัวกรองการจัดส่ง";
export const DELIVERY_OVERDUE_FLAG = "เลยกำหนด";
// Spec 311 U1 — project disambiguation on multi-project worklists. Shared by
// the /requests site chip row and the procurement filter bar (UI-term SSOT).
export const ALL_PROJECTS_OPTION_LABEL = "ทุกโครงการ";
export const PROJECT_FILTER_ARIA = "กรองตามโครงการ";
// Spec 311 U5 — shown on /payroll when a project filter is active: payment
// recording/status is period-wide (wage_payments has no project dimension), so
// the paid/drift reconciliation is only meaningful in the ทุกโครงการ view.
export const PAYROLL_PAYMENT_PERIOD_WIDE_NOTE =
  "การจ่ายค่าแรงบันทึกรวมทุกโครงการต่อรอบ — ดูและบันทึกสถานะการจ่ายที่มุมมองทุกโครงการ";
// Spec 307 — ของเข้า day headers (arrival grain: one card per day × supplier).
export const STORE_INCOMING_DAY_TODAY = "วันนี้";
export const STORE_INCOMING_DAY_UNSCHEDULED = "ยังไม่ระบุกำหนดส่ง";
// The count chips carry an accessible name — a bare number is meaningless to a
// screen reader. The top badge counts all incoming; a day header counts that
// day's arrivals — distinct names so they don't read as the same quantity.
export function storeIncomingCountAria(n: number): string {
  return `จำนวนของเข้าทั้งหมด: ${n}`;
}
export function storeIncomingDayCountAria(n: number): string {
  return `จำนวนเที่ยวส่ง: ${n}`;
}

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
// the settings-hub link, the list page title, the editor's back label, and the
// procurement hub's ขอบเขต door (that door hardcoded "แผนสั่งซื้อ" until
// 2026-07-18 — ambiguous, and it disagreed with its own page).
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

// Spec 324 — receipt-miscount correction (an over-accepted store delivery trued
// DOWN to what actually arrived). Back-office (U5) corrects; the on-site SA (U6)
// escalates via a flag. Single-sourced so the queue, the correct panel, and the
// receipt-row controls stay in step.
export const RECEIPT_CORRECTION_QUEUE_LABEL = "รายการรอแก้ไขจำนวนรับ";
export const RECEIPT_CORRECTION_CORRECT_LABEL = "แก้จำนวนที่รับ"; // BO direct-correct control on a receipt row
export const RECEIPT_CORRECTION_APPROVE_LABEL = "อนุมัติแก้ไข"; // decide → apply the SA flag
export const RECEIPT_CORRECTION_REJECT_LABEL = "ปฏิเสธ";
export const RECEIPT_CORRECTION_CONFIRM_REJECT_LABEL = "ยืนยันปฏิเสธ";
export const RECEIPT_CORRECTION_SAVE_LABEL = "บันทึกแก้ไข"; // direct-correct submit
export const RECEIPT_CORRECTION_TRUE_QTY_LABEL = "จำนวนที่รับจริง";
export const RECEIPT_CORRECTION_REASON_LABEL = "เหตุผล";
export const RECEIPT_CORRECTION_REJECT_NOTE_LABEL = "เหตุผลที่ปฏิเสธ";
export const RECEIPT_CORRECTION_QUEUE_EMPTY = "ยังไม่มีรายการรอแก้ไขจำนวนรับ";
export const RECEIPT_CORRECTION_ORDERED_HINT = "สั่ง"; // "สั่ง {ordered}" — the booked/ordered qty
export const RECEIPT_CORRECTION_FLAGGED_QTY_HINT = "หน้างานแจ้งว่ารับจริง";
// The §5 fresh-pool refusal (errcode 22023): the receipt's pool was already
// issued / returned / re-counted, so a partial receipt-cost correction is no
// longer provably exact — reverse the เบิก first, or reconcile with ตรวจนับ.
export const RECEIPT_FRESH_POOL_GUIDE =
  "ของถูกเบิก/คืน/ปรับยอดไปแล้ว จึงแก้จำนวนรับไม่ได้ — ถ้าจำเป็น ให้กลับรายการเบิกก่อน หรือใช้การตรวจนับเพื่อปรับยอด";
export const RECEIPT_CORRECTION_NO_PERMISSION = "ไม่มีสิทธิ์ (เฉพาะฝ่ายจัดซื้อ/ผู้จัดการ)";
export const RECEIPT_CORRECTION_FAILED = "แก้ไขจำนวนรับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
// The flagged-receipt state — shown on the receipt row + the item timeline while
// a pending flag awaits back-office review (U6 surfaces it in both places).
export const RECEIPT_CORRECTION_PENDING_LABEL = "⚠ รอแก้ไข";

// Spec 324 U6 — the on-site SA escalation. The SA who received a delivery flags a
// suspected over-count (true count + reason + a REQUIRED live-camera photo); the
// back-office correction authority (U5) applies or rejects it. The SA never
// reverses/corrects the receipt directly (that is BACK_OFFICE-gated).
export const RECEIPT_FLAG_LABEL = "รายงานว่าบันทึกผิด";
export const RECEIPT_FLAG_SUBMIT_LABEL = "ส่งรายงาน";
export const RECEIPT_FLAG_PHOTO_LABEL = "รูปถ่ายหลักฐาน";
export const RECEIPT_FLAG_PHOTO_REQUIRED = "กรุณาถ่ายรูปหลักฐานก่อนส่ง";
export const RECEIPT_FLAG_RANGE = "จำนวนที่รับจริงต้องน้อยกว่าที่บันทึกไว้";
export const RECEIPT_FLAG_REASON_REQUIRED = "กรุณากรอกเหตุผล";
export const RECEIPT_FLAG_ALREADY_PENDING = "มีการรายงานรออยู่แล้ว รอฝ่ายจัดซื้อตรวจสอบ";
export const RECEIPT_FLAG_CLOSED = "ใบรับนี้ปิดรับการรายงานแล้ว (เคยถูกปฏิเสธ)";
export const RECEIPT_FLAG_NOT_MEMBER = "ไม่มีสิทธิ์รายงานสำหรับโครงการนี้";
export const RECEIPT_FLAG_FAILED = "ส่งรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

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
// Spec 312 follow-up 2 — a correction that zeroes every amount is how a
// settlement is cancelled (append-only: there is no delete). Surfaced in the
// open correction form so the void signpost's "แก้ไขยอดให้เป็น 0" step is
// recognisable at the settlement.
export const RENTAL_SETTLEMENT_ZERO_CANCELS_HINT = "แก้ไขยอดเป็น 0 = ยกเลิกการปิดยอดนี้";
// Spec 205 — the per-WP labor budget (a money cost ceiling, PM/PD-set; PM review only).
export const LABOR_BUDGET_LABEL = "งบค่าแรง";
export const SET_LABOR_BUDGET_LABEL = "ตั้งงบค่าแรง";
export const EDIT_LABOR_BUDGET_LABEL = "แก้งบค่าแรง";
export const LABOR_BUDGET_USED_LABEL = "ใช้ไป";
export const LABOR_BUDGET_REMAINING_LABEL = "คงเหลือ";
export const LABOR_BUDGET_OVER_LABEL = "เกินงบ";
export const LABOR_BUDGET_UNSET_LABEL = "ยังไม่ได้ตั้งงบค่าแรง";

// Spec 325 U2 — the per-project cost view (ต้นทุน = per-WP material + labour +
// project family totals). One term everywhere it appears: project chip
// aria-label, page title, procurement hub door (U3).
export const PROJECT_COSTS_LABEL = "ต้นทุนโครงการ";

// Spec 330 — the per-project team map (staff tiers + crew teams). One term
// everywhere it appears: page title/heading + the project cockpit door aria.
export const PROJECT_TEAM_LABEL = "ทีมงานโครงการ";

// Spec 338 U3 — the placing trade-mismatch hint on the team map. ADVISORY
// only (the drop never disables); rendered on the crew card while placing AND
// in the assigned plan-chip sheet — 2 surfaces, so it lives here.
export const TRADE_MISMATCH_HINT = "หัวหน้าทีมยังไม่มีสายงานนี้";

// Spec 323 follow-up — the per-project supply plan (แผนจัดหา). One term
// everywhere it appears: the supply-plan page title/heading, the project chip
// aria-label, and the procurement hub Scope door. Distinct from
// ORDERING_TEMPLATES_LABEL — the project's plan vs the template that seeds it.
export const SUPPLY_PLAN_LABEL = "แผนจัดหา";

// Feedback 26425c1e/17cba555 — the procurement worklist product-name search.
export const PRODUCT_SEARCH_LABEL = "ค้นหาสินค้า";

// Spec 327 U1 — the procurement dashboard's alert vocabulary. เสี่ยงช้า = a PR
// whose eta lands after its anchor WP's planned start (the late-risk SSOT,
// late-risk.ts); shown on the dashboard alert strip + project cards, the U2
// scope rows, and the U3 time list. ของเข้าวันนี้ was inline on the hub strip
// until the dashboard made it a 2+-place term.
export const LATE_RISK_LABEL = "เสี่ยงช้า";
export const ARRIVALS_TODAY_LABEL = "ของเข้าวันนี้";

// Spec 327 U3 — the เวลา sub-view pills. ไทม์ไลน์ was inline on the WP
// schedule switcher (schedule-views.tsx) until the procurement time view made
// it a 2+-place term; สัปดาห์นี้ names the week radar.
export const THIS_WEEK_LABEL = "สัปดาห์นี้";
export const TIMELINE_LABEL = "ไทม์ไลน์";

// Spec 327 U4 — the timeline shelves (§0.1 labeled buckets). ยังไม่กำหนดวันที่
// was inline on the WP schedule gantt until the procurement timeline made it a
// 2+-place term; ไม่ทราบวันถึง names the active-PR no-eta bucket.
export const UNDATED_WP_LABEL = "ยังไม่กำหนดวันที่";
export const NO_ETA_LABEL = "ไม่ทราบวันถึง";

// Spec 327 U5 — the no-plan state (2+-place: the U2 scope-row create-plan door
// + the U5 resources rows). The chip IS a door to supply-plan creation (§0.3).
export const NO_PLAN_LABEL = "ยังไม่มีแผนจัดหา";
export const PRODUCT_SEARCH_PLACEHOLDER = "ชื่อสินค้า…";

// Spec 325 Phase 2 — the ของเสีย/แก้ไข (breakage + rework) exposure line: cost
// routed by cause, carved out of ค่าวัสดุ, budgeted ฿0 (any amount reads as over
// — accountability by exposure, not burial). Project grain.
export const REWORK_LINE_LABEL = "ของเสีย/แก้ไข";
export const REWORK_LINE_HINT = "ต้นทุนตามสาเหตุ · แยกจากค่าวัสดุเพื่อความรับผิดชอบ";
export const REWORK_LINE_ZERO = "ยังไม่มีของเสีย/แก้ไขที่บันทึก";

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
// Spec 308 — the dedicated delivery receive page (ของเข้า owns receiving; จัดซื้อ
// = orders). Page title + the required-truck-photo confirm gate copy.
export const DELIVERY_RECEIVE_PAGE_TITLE = "รับของ";
export const TRUCK_PHOTO_REQUIRED_HINT = "ถ่ายรูปของที่มาส่งอย่างน้อย 1 รูป ก่อนยืนยันรับเข้าคลัง";

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

// Spec 144 / 337 U5 — filing a defect on a finished งานย่อย, which reopens it to
// งานแก้ไข. Single-sourced once the list's เสร็จแล้ว door joined the WP detail's
// own control as a second surface.
export const REPORT_DEFECT_LABEL = "รายงานข้อบกพร่อง";

// Spec 217 / 337 U5 follow-up — a client-reported defect is a PM-tier act, so
// `reopen_work_package_for_defect` refuses p_source='client' for site_admin and
// auditor. The RPC answers 42501, which the action otherwise reads as a
// MEMBERSHIP failure; this is the honest reason for that specific refusal.
// Worded as the TIER, not one role: the gate is PM_ROLES, which also admits
// project_director and super_admin.
export const CLIENT_DEFECT_NOT_PERMITTED =
  "เฉพาะระดับผู้จัดการโครงการขึ้นไปจึงแจ้งแบบ “ลูกค้าแจ้ง” ได้";

// Shown below PM tier in place of the source picker: the filing IS recorded as
// ตรวจภายใน, so say so rather than stamping a provenance the filer never saw.
export const DEFECT_SOURCE_FIXED_INTERNAL = "ที่มาของข้อบกพร่อง: ตรวจภายใน";
export const DEFECT_SOURCE_CLIENT_IS_PM = "หากลูกค้าเป็นผู้แจ้ง ให้ผู้จัดการโครงการเป็นผู้บันทึก";

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

// Spec 322 — the applicant "sent back for edit" card (sibling of the pending
// notice; shown in the same slot when the approver returned the row with a note).
// Copy centralized alongside the pending-notice copy above (its direct sibling).
export const REGISTRATION_RETURNED_NOTICE_HEADING = "ต้องแก้ไขแล้วส่งใหม่";
export const REGISTRATION_RETURNED_NOTICE_BODY =
  "ผู้ตรวจขอให้แก้ไขรายการด้านล่างนี้ แล้วบันทึกส่งใหม่ในแบบฟอร์มด้านล่าง";

// Spec 286 U1 — the two self-onboard door headings. The staff self-registration
// flow is role-neutral (spec 263/264); these label the two entry variants. The
// STATUS heading is the neutral heading shown once a registration exists (the
// pending/rejected view an office applicant is redirected into on the shared
// workspace) — so that view never re-shows the on-site "สมัครเป็นช่าง".
export const REGISTER_FIELD_HEADING = "สมัครเป็นช่าง";
export const REGISTER_OFFICE_HEADING = "สมัครงานสำนักงาน";
export const REGISTER_STATUS_HEADING = "ใบสมัครของคุณ";

// Spec 342 — invite-only office onboarding.
/** The read-only invited-role line on the register form (approver sheet: spec 342 U3). */
export const INVITED_ROLE_LABEL = "ตำแหน่งที่เชิญ";
/** The /register/office gate screen (no valid invite link). */
export const OFFICE_INVITE_REQUIRED_HEADING = "หน้านี้ต้องเปิดจากลิงก์เชิญ";
export const OFFICE_INVITE_REQUIRED_HINT =
  "การสมัครงานสำนักงานต้องใช้ลิงก์เชิญ กรุณาติดต่อฝ่ายบุคคลหรือผู้จัดการเพื่อขอลิงก์";
/** The /coming-soon replacement line for the retired office door. */
export const OFFICE_ASK_INVITE_LINE = "สมัครงานสำนักงาน? ติดต่อฝ่ายบุคคลเพื่อขอลิงก์เชิญ";
/** The /settings/roles mint block. */
export const OFFICE_INVITE_BLOCK_TITLE = "ลิงก์เชิญพนักงานออฟฟิศ";
export const OFFICE_INVITE_BLOCK_HINT =
  "สร้างลิงก์เชิญตามตำแหน่ง ส่งให้ผู้สมัครทาง LINE — ลิงก์ใช้ซ้ำได้ ผู้อนุมัติยืนยันตำแหน่งอีกครั้งตอนอนุมัติ";

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

// Spec 310 — company-card registry (superadmin manages who holds which card).
export const CARD_REGISTRY_LABEL = "บัตรเครดิตบริษัท";
export const CARD_REGISTRY_HINT = "จัดการบัตรและผู้ถือบัตร (ไม่เก็บเลขบัตรเต็ม)";
export const CARD_NAME_LABEL = "ชื่อบัตร";
export const CARD_HOLDER_LABEL = "ผู้ถือบัตร";
export const CARD_LAST4_LABEL = "เลข 4 ตัวท้าย (ถ้ามี)";
export const CARD_ADD_LABEL = "เพิ่มบัตร";
export const CARD_SAVE_LABEL = "บันทึก";
export const CARD_CANCEL_LABEL = "ยกเลิก";
export const CARD_EDIT_LABEL = "แก้ไข";
export const CARD_DEACTIVATE_LABEL = "ปิดใช้งาน";
export const CARD_DEACTIVATE_PENDING = "กำลังปิด…";
export const CARD_DEACTIVATE_CONFIRM = "ปิดใช้งานบัตรนี้? (เพิ่มใหม่ได้ภายหลัง)";
export const CARD_INACTIVE_BADGE = "ปิดใช้งานแล้ว";
export const CARD_EMPTY = "ยังไม่มีบัตร";

// Spec 310 U3 — the office-expense form + list at /expenses (reached via ตั้งค่า).
export const OFFICE_EXPENSE_NAV_LABEL = "ค่าใช้จ่ายสำนักงาน";
export const OFFICE_EXPENSE_HINT = "บันทึกค่าใช้จ่ายที่ไม่ผูกกับงาน (เช่น น้ำมัน ค่ารับรอง)";
export const EXPENSE_CATEGORY_LABEL = "ประเภทค่าใช้จ่าย";
export const EXPENSE_CATEGORY_PLACEHOLDER = "เลือกประเภท";
export const EXPENSE_AMOUNT_LABEL = "จำนวนเงิน (บาท)";
export const EXPENSE_DATE_LABEL = "วันที่จ่าย";
export const EXPENSE_PROJECT_LABEL = "โครงการ (ถ้ามี)";
export const EXPENSE_PROJECT_NONE = "— ไม่ระบุโครงการ —";
export const EXPENSE_DESCRIPTION_LABEL = "รายละเอียด";
export const EXPENSE_PAYMENT_SOURCE_LABEL = "จ่ายจาก";
// Spec 310 U11 — short chip labels so จ่ายจาก fits one line (operator 2026-07-13);
// each pairs with an icon + the คืนเงิน hint below carries the reimburse meaning.
// สำรองจ่าย (front the money) reads clearer than "จ่ายเงินตัวเอง".
export const PAYMENT_SOURCE_CARD_LABEL = "บัตรเครดิต";
export const PAYMENT_SOURCE_OWN_LABEL = "สำรองจ่าย";
export const PAYMENT_SOURCE_DIRECT_LABEL = "บริษัทจ่ายตรง";
export const EXPENSE_CARD_PICK_LABEL = "เลือกบัตร";
// Spec 310 U8 — a user holds one card; no picker, the form shows which card auto-applies.
export const EXPENSE_CARD_USING_PREFIX = "จ่ายด้วยบัตร";
// Spec 310 U9 — two labeled upload slots (accounting needs slip + tax invoice apart).
export const EXPENSE_SLIP_UPLOAD_LABEL = "แนบสลิปการโอน/จ่าย";
export const EXPENSE_INVOICE_UPLOAD_LABEL = "แนบใบกำกับภาษี/ใบเสร็จ";
export const EXPENSE_SUBMIT_LABEL = "บันทึกค่าใช้จ่าย";
export const EXPENSE_REIMBURSE_TO_PREFIX = "คืนเงินให้";
export const EXPENSE_REIMBURSE_SELF = "คืนเงินให้คุณเอง";
export const EXPENSE_REIMBURSE_NONE = "ไม่ต้องคืนเงิน";
export const EXPENSE_AWAITING_RECEIPT = "รอใบเสร็จ";
export const EXPENSE_REIMBURSED_BADGE = "คืนแล้ว";
export const EXPENSE_LIST_EMPTY = "ยังไม่มีรายการ";
// Spec 310 U4 — receipt upload.
export const EXPENSE_RECEIPT_UPLOAD_LABEL = "แนบใบเสร็จ";
export const EXPENSE_RECORDED_ATTACH = "บันทึกแล้ว — แนบใบเสร็จได้เลย";
// Spec 310 U7 — personal expense dashboard (summary + category chart).
export const EXPENSE_MONTH_TOTAL_LABEL = "ใช้จ่ายเดือนนี้";
export const EXPENSE_PENDING_TOTAL_LABEL = "รอคืนเงิน (ของคุณ)";
export const EXPENSE_CHART_HEADING = "ค่าใช้จ่ายตามประเภท (เดือนนี้)";
export const EXPENSE_MONTH_EMPTY = "ยังไม่มีค่าใช้จ่ายเดือนนี้";
export const EXPENSE_ADD_HEADING = "บันทึกค่าใช้จ่ายใหม่";
// Spec 310 U10 — form moved into a FAB + bottom sheet; attachments on top (so an
// LLM can later prefill fields from them); รายละเอียด optional with a hint.
export const EXPENSE_ADD_LABEL = "เพิ่มค่าใช้จ่าย";
export const EXPENSE_ATTACH_HEADING = "แนบเอกสาร (ถ้ามี)";
export const EXPENSE_DESCRIPTION_HELP = "ไม่บังคับ — เช่น จ่ายค่าอะไร / ซื้อจากที่ไหน";
// Spec 310 U5 — finance reimburse queue.
export const REIMBURSE_QUEUE_HEADING = "รายการรอคืนเงิน";
export const REIMBURSE_QUEUE_EMPTY = "ไม่มีรายการรอคืนเงิน";
export const REIMBURSE_TOTAL_PREFIX = "รวม";
export const REIMBURSE_MARK_LABEL = "คืนเงินแล้ว";
export const REIMBURSE_MARK_PENDING = "กำลังบันทึก…";
export const REIMBURSE_MARK_CONFIRM = "ยืนยันว่าคืนเงินรายการนี้แล้ว?";

// Spec 318 U2 — notification readiness (OA add-friend banner + settings card).
export const NOTIF_READINESS_TITLE = "เปิดรับการแจ้งเตือน";
export const NOTIF_READINESS_BODY = "เพิ่มเพื่อน LINE ของบริษัท เพื่อรับแจ้งเตือนงานและคำขอของคุณ";
export const NOTIF_ADD_FRIEND_LABEL = "เพิ่มเพื่อน";

// Spec 318 U4 — /settings/notifications page.
export const NOTIF_SETTINGS_LABEL = "การแจ้งเตือน";
export const NOTIF_SETTINGS_HINT = "เลือกเรื่องที่อยากรับแจ้งเตือนทาง LINE";
export const NOTIF_SETTINGS_INTRO =
  "เปิด/ปิดการแจ้งเตือนแต่ละเรื่องได้ตามต้องการ การแจ้งเตือนความปลอดภัยหน้างานปิดไม่ได้";
export const NOTIF_LOCKED_HINT = "การแจ้งเตือนความปลอดภัย — ปิดไม่ได้";
export const NOTIF_TEST_MESSAGE = "🔔 ทดสอบการแจ้งเตือนจาก PRC Ops — คุณจะได้รับแจ้งเตือนแบบนี้";
export const NOTIF_TEST_BUTTON = "ส่งข้อความทดสอบเข้า LINE";
export const NOTIF_TEST_SENT = "ส่งแล้ว — เปิด LINE เพื่อดูข้อความทดสอบ";
export const NOTIF_READINESS_CARD_HEADING = "สถานะการรับแจ้งเตือน";
export const NOTIF_LINE_LINKED_ROW = "เชื่อมบัญชี LINE แล้ว";
export const NOTIF_OA_FRIEND_ROW = "เพิ่มเพื่อน LINE ของบริษัทแล้ว";
export const NOTIF_OA_NONFRIEND_ROW = "ยังไม่ได้เพิ่มเพื่อน LINE ของบริษัท";
export const NOTIF_OA_UNKNOWN_ROW = "จะตรวจสอบเมื่อเข้าสู่ระบบด้วย LINE ครั้งถัดไป";
export const NOTIF_TELEGRAM_ROW = "เชื่อม Telegram แล้ว";
export const NOTIF_TEST_NONFRIEND_ERROR =
  "ส่งไม่สำเร็จ — ยังไม่ได้เพิ่มเพื่อน LINE ของบริษัท กดปุ่มเพิ่มเพื่อนด้านบนก่อน";

// Spec 320 — temporary payout nominee (PM-managed bridge for bankless workers).
export const PAYOUT_NOMINEE_TITLE = "บัญชีตัวแทนรับเงิน (ชั่วคราว)";
export const PAYOUT_NOMINEE_ADD = "เพิ่มบัญชีตัวแทน";
export const PAYOUT_NOMINEE_CLEAR = "ล้างบัญชีตัวแทน";
export const PAYOUT_NOMINEE_EMPTY = "ยังไม่มีช่างที่ใช้บัญชีตัวแทน";
export const PAYOUT_NOMINEE_SUBMIT = "บันทึกบัญชีตัวแทน";
export const PAYOUT_NOMINEE_CONSENT_REQUIRED = "กรุณาแนบรูปหนังสือยินยอม";
export const PAYOUT_NOMINEE_PROMPTPAY_HINT =
  "ถ้าช่างมีพร้อมเพย์ ให้ลงทะเบียนบัญชีตัวเองแทนการใช้บัญชีตัวแทน";

// Spec 329 — company documents library (เอกสารบริษัท).
export const COMPANY_DOCS_LABEL = "เอกสารบริษัท";
export const COMPANY_DOCS_HINT = "หนังสือรับรอง · ภ.พ.20 · โปรไฟล์บริษัท";
export const COMPANY_DOC_UPLOAD_LABEL = "อัปโหลดเอกสาร";
export const COMPANY_DOC_NEW_VERSION_LABEL = "เวอร์ชันใหม่";
export const COMPANY_DOC_RETIRE_LABEL = "ถอนเอกสารออก";
export const COMPANY_DOC_RETIRE_CONFIRM_LABEL = "ยืนยันถอนเอกสาร";
export const COMPANY_DOC_SHARE_LABEL = "แชร์ลิงก์";
export const COMPANY_DOC_SHARE_COPIED_LABEL = "คัดลอกลิงก์แล้ว (ใช้ได้ 7 วัน)";
export const COMPANY_DOC_DOWNLOAD_LABEL = "ดาวน์โหลด";
export const COMPANY_DOC_HISTORY_LABEL = "ประวัติเวอร์ชัน";
export const COMPANY_DOC_EXPIRED_LABEL = "หมดอายุ";
export const COMPANY_DOC_EXPIRING_LABEL = "ใกล้หมดอายุ";
export const COMPANY_DOC_ISSUED_LABEL = "วันที่ออกเอกสาร";
export const COMPANY_DOC_EXPIRES_LABEL = "วันหมดอายุ";
export const COMPANY_DOC_TITLE_LABEL = "ชื่อเอกสาร";
export const COMPANY_DOC_NOTE_LABEL = "หมายเหตุ";
export const COMPANY_DOC_FILE_LABEL = "ไฟล์เอกสาร";
export const COMPANY_DOC_EMPTY_LABEL = "ยังไม่มีเอกสารบริษัท";

// Spec 329 follow-up — upload picker affordance (operator feedback 2026-07-19).
export const COMPANY_DOC_PICK_LABEL = "แตะเพื่อเลือกไฟล์";
export const COMPANY_DOC_PICK_HINT = "PDF หรือรูปภาพ · ไม่เกิน 25MB";
export const COMPANY_DOC_PICK_CHANGE_LABEL = "แตะเพื่อเปลี่ยนไฟล์";
export const COMPANY_DOC_FILE_TOO_BIG = "ไฟล์ใหญ่เกิน 25MB กรุณาเลือกไฟล์ที่เล็กกว่า";
// Spec 331 — document type registry (มาตรฐานเอกสารบริษัท).
export const COMPANY_DOC_CATEGORY_LABEL = "หมวดเอกสาร";
export const COMPANY_DOC_TYPE_LABEL = "ประเภทเอกสาร";
export const COMPANY_DOC_TYPE_PLACEHOLDER = "เลือกประเภทเอกสาร";
export const COMPANY_DOC_INSTANCE_LABEL = "รายละเอียด (เช่น ธนาคาร / โครงการ)";
export const COMPANY_DOC_MISSING_HEADING = "ยังขาด";
export const COMPANY_DOC_MISSING_HINT = "เอกสารที่บริษัทควรมีแต่ยังไม่ได้อัปโหลด";
export const COMPANY_DOC_MISSING_NONE = "เอกสารที่จำเป็นครบแล้ว";
export const COMPANY_DOC_TYPES_LABEL = "ตั้งค่าประเภทเอกสาร";
export const COMPANY_DOC_TYPES_HINT = "หมวดและประเภทเอกสารบริษัท (เฉพาะผู้ดูแลระบบ)";
export const COMPANY_DOC_DUPLICATE_ERROR = "มีเอกสารประเภทนี้อยู่แล้ว ใช้ปุ่มเวอร์ชันใหม่แทน";
export const COMPANY_DOC_REQUIRED_BADGE = "ต้องมี";
export const COMPANY_DOC_PICK_TYPE_FIRST = "กรุณาเลือกไฟล์ ประเภทเอกสาร และกรอกรายละเอียดให้ครบ";
// Spec 331 (operator feedback 2026-07-19): the generic upload is now a quiet
// end-of-page action for documents the ยังขาด checklist doesn't cover.
export const COMPANY_DOC_UPLOAD_OTHER_LABEL = "อัปโหลดเอกสารอื่น";
export const COMPANY_DOC_OTHER_CATEGORY_LABEL = "อื่น ๆ";

// Spec 318 U3 — the notification catalog SSOT. One entry per
// notification_event_type: Thai label + description (the settings page and
// docs/automations.md both read from here so they cannot drift), the
// category it groups under, the role audience that can actually receive it
// (mirrors resolve-recipients rules — role sets from role-home, never
// literals), and the locked flag (safety alerts are unmutable).
//
// Compile-time completeness: CATALOG_BY_EVENT is `satisfies Record<
// NotificationEventType, ...>` — adding an enum value without a catalog
// entry fails typecheck (the TS twin of the pgTAP enum-lockstep pins).

import type { Database } from "@/lib/db/database.types";
import {
  BACK_OFFICE_ROLES,
  PM_ROLES,
  PROCUREMENT_MANAGER_ROLES,
  PURCHASING_ROLES,
  SITE_STAFF_ROLES,
  type UserRole,
} from "@/lib/auth/role-home";

export type NotificationEventType = Database["public"]["Enums"]["notification_event_type"];

export type NotificationCategory =
  | "my_work"
  | "approvals"
  | "my_requests"
  | "system"
  | "serious_issues";

export const NOTIFICATION_CATEGORY_ORDER: readonly NotificationCategory[] = [
  "my_work",
  "approvals",
  "my_requests",
  "serious_issues",
  "system",
];

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  my_work: "งานของฉัน",
  approvals: "การอนุมัติ",
  my_requests: "คำขอซื้อของฉัน",
  serious_issues: "เหตุร้ายแรง",
  system: "ระบบ",
};

export interface NotificationCatalogEntry {
  event: NotificationEventType;
  /** Thai display label on /settings/notifications. */
  label: string;
  /** One-line Thai explanation of when this fires. */
  description: string;
  category: NotificationCategory;
  /** Can this role ever be a recipient? (mirrors resolve-recipients). */
  audience: (role: UserRole) => boolean;
  /** Locked = cannot be muted (set_notification_preference refuses). */
  locked: boolean;
}

/**
 * The serializable half of a catalog entry (no `audience` function) — the shape
 * a Server Component may hand to the client toggle form. Passing the full entry
 * across the RSC boundary throws ("Functions cannot be passed to Client
 * Components"); the server filters by `audience` then maps to this.
 */
export type NotificationToggleEntry = Omit<NotificationCatalogEntry, "audience">;

export function toToggleEntry(entry: NotificationCatalogEntry): NotificationToggleEntry {
  return {
    event: entry.event,
    label: entry.label,
    description: entry.description,
    category: entry.category,
    locked: entry.locked,
  };
}

const pmTier = (role: UserRole) => PM_ROLES.includes(role);
const uploaderTier = (role: UserRole) => SITE_STAFF_ROLES.includes(role);
const requesterTier = (role: UserRole) => PURCHASING_ROLES.includes(role);
const operatorOnly = (role: UserRole) => role === "super_admin";
const siteIssueTier = (role: UserRole) => PROCUREMENT_MANAGER_ROLES.includes(role);
const backOfficeTier = (role: UserRole) => BACK_OFFICE_ROLES.includes(role);

export const NOTIFICATION_CATALOG_BY_EVENT = {
  wp_pending_approval: {
    event: "wp_pending_approval",
    label: "งานรออนุมัติ",
    description: "งานถูกส่งตรวจ รอการอนุมัติจากผู้จัดการโครงการ",
    category: "approvals",
    audience: pmTier,
    locked: false,
  },
  wp_decision: {
    event: "wp_decision",
    label: "ผลการตรวจงาน",
    description: "งานที่คุณถ่ายรูปส่งได้รับการอนุมัติหรือให้แก้ไข",
    category: "my_work",
    audience: uploaderTier,
    locked: false,
  },
  wp_evidence_resubmitted: {
    event: "wp_evidence_resubmitted",
    label: "ส่งตรวจอีกครั้ง",
    description: "งานที่คุณให้ถ่ายรูปใหม่ถูกถ่ายเพิ่มและส่งกลับมาให้ตรวจแล้ว",
    category: "approvals",
    audience: pmTier,
    locked: false,
  },
  wp_reopened: {
    event: "wp_reopened",
    label: "งานถูกเปิดแก้ไขใหม่",
    description: "งานที่เสร็จแล้วถูกเปิดกลับมาให้แก้ไข",
    category: "my_work",
    audience: uploaderTier,
    locked: false,
  },
  pr_created: {
    event: "pr_created",
    label: "คำขอซื้อใหม่",
    description: "มีคำขอซื้อใหม่รอการอนุมัติ",
    category: "approvals",
    audience: pmTier,
    locked: false,
  },
  pr_decision: {
    event: "pr_decision",
    label: "ผลอนุมัติคำขอซื้อ",
    description: "คำขอซื้อของคุณได้รับการอนุมัติหรือปฏิเสธ",
    category: "my_requests",
    audience: requesterTier,
    locked: false,
  },
  pr_progress: {
    event: "pr_progress",
    label: "ความคืบหน้าคำขอซื้อ",
    description: "คำขอซื้อของคุณถูกสั่งซื้อ กำลังจัดส่ง หรือส่งถึงแล้ว",
    category: "my_requests",
    audience: requesterTier,
    locked: false,
  },
  pr_cancelled: {
    event: "pr_cancelled",
    label: "คำขอซื้อถูกยกเลิก",
    description: "คำขอซื้อของคุณถูกยกเลิก",
    category: "my_requests",
    audience: requesterTier,
    locked: false,
  },
  feedback_submitted: {
    event: "feedback_submitted",
    label: "เรื่องแจ้งใหม่",
    description: "มีผู้ส่งเรื่องแจ้ง/ข้อเสนอแนะใหม่เข้าระบบ",
    category: "system",
    audience: operatorOnly,
    locked: false,
  },
  site_issue_reported: {
    event: "site_issue_reported",
    label: "ปัญหาหน้างานร้ายแรง",
    description: "มีการแจ้งปัญหาความปลอดภัย ทางเข้า หรือเครื่องมือที่หน้างาน (ปิดไม่ได้)",
    category: "serious_issues",
    audience: siteIssueTier,
    locked: true,
  },
  receipt_correction_flagged: {
    event: "receipt_correction_flagged",
    label: "แจ้งแก้ไขจำนวนรับของ",
    description: "หน้างานรายงานว่าบันทึกรับของเกินจำนวนที่มาจริง รอฝ่ายจัดซื้อแก้ไข",
    category: "approvals",
    audience: backOfficeTier,
    locked: false,
  },
  receipt_correction_resolved: {
    event: "receipt_correction_resolved",
    label: "ผลการแก้ไขจำนวนรับของ",
    description: "การแจ้งแก้ไขจำนวนรับของที่คุณส่งได้รับการดำเนินการแล้ว",
    category: "my_work",
    audience: uploaderTier,
    locked: false,
  },
} as const satisfies Record<NotificationEventType, NotificationCatalogEntry>;

export const NOTIFICATION_CATALOG: readonly NotificationCatalogEntry[] = Object.values(
  NOTIFICATION_CATALOG_BY_EVENT,
);

export const LOCKED_NOTIFICATION_EVENTS: readonly NotificationEventType[] =
  NOTIFICATION_CATALOG.filter((entry) => entry.locked).map((entry) => entry.event);

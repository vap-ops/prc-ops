// Spec 381 U2 — one history row → one Thai line.
//
// The kinds come from the U1 `equipment_item_history` RPC, which unions four
// sources: `movement_' || equipment_movement_kind` (five), `loan_out` /
// `loan_returned`, `item_updated` (a field diff), and `rate_change` (money —
// present only for the back-office audience, omitted entirely otherwise).
//
// The field labels deliberately repeat the words the EDIT SHEET uses rather than
// the column names: a reader who sees "ชื่ออุปกรณ์ เปลี่ยน" and then opens the form
// finds the same words. Pinned by test in both directions, so a new audited field
// in the trigger cannot ship without a label here.

import { bahtCompact } from "@/lib/format";

export const EQUIPMENT_HISTORY_KIND_LABEL = {
  movement_received: "รับเข้าคลัง",
  movement_deployed: "ส่งไปโครงการ",
  movement_returned: "คืนกลับคลัง",
  movement_maintenance: "ส่งซ่อมบำรุง",
  movement_lost: "แจ้งสูญหาย",
  loan_out: "ยืมออก",
  loan_returned: "คืนแล้ว",
  item_updated: "แก้ไขข้อมูล",
  rate_change: "เปลี่ยนค่าเช่า",
  // Spec 367 §10.4 — the purchase cost / acquired-on, from the RPC's fifth arm.
  // A separate KIND, not a second meaning for rate_change: this map is what the
  // reader sees, so one label per real-world event or the history lies.
  acquisition_change: "บันทึกราคาทุน",
} as const;

export type EquipmentHistoryKind = keyof typeof EQUIPMENT_HISTORY_KIND_LABEL;

/** Exactly the fields the U1 trigger diffs — same words as the edit form. */
export const EQUIPMENT_FIELD_LABEL: Record<string, string> = {
  name: "ชื่ออุปกรณ์",
  category_id: "หมวดหมู่",
  owner_id: "เจ้าของ",
  status: "สถานะ",
  tracking: "ประเภทการติดตาม",
  asset_tag: "รหัสครุภัณฑ์",
  quantity: "จำนวน",
  brand: "ยี่ห้อ",
  model: "รุ่น",
  serial_no: "หมายเลขเครื่อง",
  condition: "สภาพ",
  description: "รายละเอียด",
  image_path: "รูปภาพ",
};

export interface HistoryEntryLike {
  kind: string;
  detail: Record<string, unknown> | null;
}

function rateText(v: unknown): string {
  return typeof v === "number" ? bahtCompact(v) : "—";
}

/** Spec 367 §10.4 — a jsonb date arrives as a string; anything else is "unset". */
function dateText(v: unknown): string {
  return typeof v === "string" && v !== "" ? v : "—";
}

/**
 * The second line under the event label, or `null` when the label already says
 * everything. Never throws on an unexpected shape: this renders a definer RPC's
 * jsonb, and a row that cannot be described must still be listed.
 */
export function describeHistoryEntry(entry: HistoryEntryLike): string | null {
  const detail = entry.detail ?? {};

  if (entry.kind === "item_updated") {
    const changes = detail["changes"];
    if (!changes || typeof changes !== "object") return null;
    const fields = Object.keys(changes as Record<string, unknown>);
    if (fields.length === 0) return null;
    // Unknown key → show it raw rather than drop it. Dropping would under-report
    // the change; the label test is what keeps this path unreachable in practice.
    return fields.map((f) => EQUIPMENT_FIELD_LABEL[f] ?? f).join(" · ");
  }

  if (entry.kind === "rate_change") {
    return `ค่าเช่า/วัน: ${rateText(detail["old_rate"])} → ${rateText(detail["new_rate"])}`;
  }

  // Spec 367 §10.4 — cost and date move together, so the line reports whichever
  // actually changed rather than restating both. A write that changed neither
  // still lists (the row exists), it just adds no second line.
  if (entry.kind === "acquisition_change") {
    const parts: string[] = [];
    if (detail["old_cost"] !== detail["new_cost"]) {
      parts.push(`ราคาทุน: ${rateText(detail["old_cost"])} → ${rateText(detail["new_cost"])}`);
    }
    if (detail["old_acquired_at"] !== detail["new_acquired_at"]) {
      parts.push(
        `วันที่ได้มา: ${dateText(detail["old_acquired_at"])} → ${dateText(detail["new_acquired_at"])}`,
      );
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  const note = detail["note"];
  return typeof note === "string" && note.trim() !== "" ? note : null;
}

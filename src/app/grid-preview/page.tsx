// Spec 113 — TEMPORARY visual preview of the procurement grid health colors
// (spec 112). Public, no auth, synthetic data — so the operator can review every
// red/amber/green/grey case on the live deploy (real data is mostly green because
// needed_by/eta are unset). DELETE after review (the spec-38 /design-preview
// precedent). Not linked from anywhere.

import { ProcurementGrid } from "@/components/features/procurement-grid";
import type { ProcurementGridRecord } from "@/components/features/procurement-grid";
import { groupByProcurementBand } from "@/lib/purchasing/procurement-pipeline";

export const metadata = { title: "Grid color preview (temporary)" };

// Fixed "today" so the crafted cases are deterministic.
const TODAY = "2026-06-15";

let n = 1000;
function rec(over: Partial<ProcurementGridRecord> & Pick<ProcurementGridRecord, "status">) {
  return {
    id: `preview-${n}`,
    pr_number: n++,
    item_description: "รายการ",
    priority: "normal",
    quantity: 1,
    unit: "ชิ้น",
    supplier: null,
    amount: null,
    eta: null,
    needed_by: null,
    requested_at: "2026-06-01T00:00:00Z",
    decided_at: null,
    purchased_at: null,
    shipped_at: null,
    delivered_at: null,
    work_package_id: "wp",
    wp_code: "WP-01",
    wp_name: "งานโครงสร้าง ชั้น 2",
    project_id: null,
    requested_by: null,
    requester_name: null,
    notes: null,
    decision_comment: null,
    received_by: null,
    delivery_note: null,
    doc_count: 0,
    ...over,
  } satisfies ProcurementGridRecord;
}

const ROWS: ProcurementGridRecord[] = [
  // รอสั่งซื้อ (not yet ordered) — pressure = needed_by
  rec({
    status: "approved",
    item_description: "เหล็กเส้น DB12 (เลยกำหนดสั่ง)",
    needed_by: "2026-06-05",
    priority: "critical",
    supplier: "ทีพีไอ",
    amount: 45000,
  }),
  rec({
    status: "approved",
    item_description: "ปูนซีเมนต์ (ใกล้กำหนด)",
    needed_by: "2026-06-19",
    supplier: "เอสซีจี",
    amount: 12500,
  }),
  rec({
    status: "approved",
    item_description: "ทราย (ตามแผน)",
    needed_by: "2026-07-30",
    supplier: "ร้านวัสดุภัณฑ์",
    amount: 8000,
  }),
  // กำลังจัดส่ง (already ordered) — pressure = will it arrive in time
  rec({
    status: "purchased",
    item_description: "ท่อ PVC (ส่งเลยกำหนด)",
    eta: "2026-06-10",
    supplier: "ทีพีไอ",
    amount: 6500,
  }),
  rec({
    status: "on_route",
    item_description: "สายไฟ (จะถึงช้ากว่าที่ต้องการ)",
    eta: "2026-06-25",
    needed_by: "2026-06-20",
    priority: "urgent",
    supplier: "ไทยไวร์",
    amount: 30000,
  }),
  rec({
    status: "purchased",
    item_description: "สีทาภายนอก (ตามแผน)",
    eta: "2026-06-17",
    needed_by: "2026-06-22",
    supplier: "เบเยอร์",
    amount: 15000,
  }),
  // ได้รับแล้ว
  rec({
    status: "delivered",
    item_description: "กระเบื้อง (รับแล้ว)",
    eta: "2026-06-08",
    supplier: "คอตโต้",
    amount: 22000,
  }),
  // รออนุมัติ
  rec({
    status: "requested",
    item_description: "ตะปู (รออนุมัติ)",
    needed_by: "2026-06-30",
  }),
];

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="text-ink-secondary inline-flex items-center gap-1.5 text-xs">
      <span className={`inline-block h-3 w-1.5 rounded-full ${cls}`} />
      {label}
    </span>
  );
}

export default function GridPreviewPage() {
  return (
    <div className="bg-page min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <p className="text-attn-ink text-xs font-semibold">
            ชั่วคราว — สำหรับตรวจสี (spec 112/113)
          </p>
          <h1 className="text-ink text-xl font-bold">ตัวอย่างสีสถานะตารางจัดซื้อ</h1>
          <p className="text-ink-secondary mt-1 text-sm">
            แถบสีซ้ายของแต่ละแถว = ความเร่งด่วนของฝ่ายจัดซื้อ (สีแดงมีความหมายต่างกันตามกลุ่ม):
            ในกลุ่ม &ldquo;รอสั่งซื้อ&rdquo; แดง = เลยกำหนดที่ต้องใช้แต่ยังไม่สั่ง; ในกลุ่ม
            &ldquo;กำลังจัดส่ง&rdquo; แดง = ส่งเลยกำหนด ETA, เหลือง = จะถึงช้ากว่าที่ต้องการ. (today
            = {TODAY})
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <LegendDot cls="bg-danger" label="ต้องรีบ / เลยกำหนด" />
            <LegendDot cls="bg-attn" label="ใกล้กำหนด" />
            <LegendDot cls="bg-done-strong" label="ตามแผน" />
            <LegendDot cls="bg-edge" label="รออนุมัติ" />
          </div>
        </div>
        <ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />
      </div>
    </div>
  );
}

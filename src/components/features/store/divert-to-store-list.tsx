"use client";

// Spec 198 U2 / ADR 0064 — divert a delivered WP-bound line into the store. The
// คลัง lists the project's delivered, WP-bound, catalogued purchase lines not yet
// diverted; the storekeeper moves one into store stock (ย้ายเข้าคลัง), which
// transfers its cost WP-WIP → Inventory (divert_purchase_to_store). The item /
// qty / cost are fixed from the PR, so this is a per-line confirm, not a grid.
// 'use client': the per-line confirm dialog + action transition.

import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";
import { divertPurchaseToStore } from "@/app/store/actions";

export type DivertLine = {
  requestId: string;
  itemLabel: string;
  qty: number;
  unit: string;
  wpLabel: string;
  cost: number;
};

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DivertToStoreList({ lines }: { lines: DivertLine[] }) {
  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-ink text-body font-semibold">ย้ายเข้าคลัง (จากการส่งของ)</h2>
      <p className="text-ink-secondary text-meta">
        วัสดุที่ส่งถึงแล้วและผูกกับงาน — ย้ายเข้าสต๊อกคลังเพื่อเบิกใช้ภายหลัง
      </p>
      <ul className="flex flex-col gap-2">
        {lines.map((l) => (
          <li
            key={l.requestId}
            className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="text-ink text-body block font-semibold">{l.itemLabel}</span>
              <span className="text-ink-secondary text-meta block">
                {l.qty} {l.unit} · {l.wpLabel} · {baht(l.cost)} ฿
              </span>
            </span>
            <ConfirmActionButton
              idleLabel="ย้ายเข้าคลัง"
              pendingLabel="กำลังย้าย…"
              confirmMessage={`ย้าย ${l.itemLabel} (${l.qty} ${l.unit}) จาก ${l.wpLabel} เข้าคลัง? ต้นทุนจะย้ายจากงานไปเป็นสต๊อกคลัง`}
              confirmLabel="ยืนยัน"
              buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
              action={() => divertPurchaseToStore({ requestId: l.requestId })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

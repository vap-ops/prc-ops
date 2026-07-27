"use client";

// Spec 363 U4 merge — the three per-issue write controls, re-homed.
//
// They lived on the เบิกของ tab's issued-line list (ยืนยันรับแทน · แก้รายการที่
// บันทึกผิด · คืนเข้าคลัง). That tab is deleted, and the spec's precondition block
// forbids deleting it before the affordances have somewhere to go — so they move
// into the ของ row detail, byte-for-byte the same actions and the same gate.
//
// 'use client' justification: ConfirmActionButton and ReturnToStoreControl are
// client components taking a CLOSURE over the issue id. A Server Component
// cannot hand a closure across the boundary, so this thin wrapper owns the
// binding. It holds no state of its own; both controls own theirs.
//
// The gate is UNCHANGED from the tab: the whole block rendered under the WP
// page's `!readOnly`, which is the reverse_stock_issue / confirm-on-behalf role
// gate. `canAct` carries the same decision here.

import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { ReturnToStoreControl } from "@/components/features/store/return-to-store-control";
import { confirmStockIssueOnBehalf, reverseStockIssue } from "@/app/store/actions";
import { STORE_FIX_WRONG_ENTRY_LABEL } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";
import type { WpThingIssue } from "@/lib/work-packages/things";

export function WpThingIssueActions({ issue }: { issue: WpThingIssue }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Spec 209 U2 — the REAL return: a partial qty of issued material goes
          back to the store (offcuts/leftovers) at the issue cost. The control
          hides itself once nothing is left to return. */}
      <ReturnToStoreControl
        issueId={issue.id}
        baseItem={issue.baseItem}
        unit={issue.unit}
        remaining={issue.qty - issue.returnedQty}
      />
      {/* Spec 210 — confirm-on-behalf: a site staffer attests receipt for a named
          receiver still รอรับ. The RPC blocks the issuer (separation of duties). */}
      {issue.receiverName && !issue.receivedAt ? (
        <ConfirmActionButton
          idleLabel="ยืนยันรับแทน"
          pendingLabel="กำลังยืนยัน…"
          confirmMessage={`ยืนยันว่าผู้รับได้รับ ${issue.baseItem} ${issue.qty} ${issue.unit} แล้ว (ยืนยันแทนผู้รับ)?`}
          confirmLabel="ยืนยัน"
          buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
          action={() => confirmStockIssueOnBehalf({ issueId: issue.id })}
        />
      ) : null}
      {/* Spec 178 Stream B — undo a wrong เบิก. NOT a return of real material:
          stock_issues is append-only, so this books a stock_reversals row. */}
      <ConfirmActionButton
        idleLabel={STORE_FIX_WRONG_ENTRY_LABEL}
        pendingLabel="กำลังแก้ไข…"
        confirmMessage={`ลบรายการเบิกที่บันทึกผิด — ${issue.baseItem} ${issue.qty} ${issue.unit}? ใช้เมื่อบันทึกผิด ไม่ใช่การคืนของจริง (ของจะถูกคืนเข้าคลัง)`}
        confirmLabel="ยืนยัน"
        buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
        action={() => reverseStockIssue({ issueId: issue.id })}
      />
    </div>
  );
}

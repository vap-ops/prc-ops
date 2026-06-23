"use client";

// Spec 177 U5 — เบิก at the WP detail. A site staffer (site_admin draws at the WP,
// plus the PM tier) pulls stock from the project store TO this work package, at
// the moving-average cost (the issue_stock RPC handles the costing + decrement).
// 'use client': the เบิก-sheet state, the submit transition, the refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { STORE_ISSUE_LABEL } from "@/lib/i18n/labels";
import { issueStock, reverseStockIssue } from "@/app/store/actions";

// On-hand for the picker — only what the WP เบิก needs (the value/avg-cost columns
// the /store console shows are not relevant when drawing to a WP).
export type WpStockRow = {
  catalogItemId: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qtyOnHand: number;
};

export type WpIssueRow = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  unitCost: number;
  // Custody (spec 177 U6/U7): the named receiver + whether they've confirmed.
  receiverName: string | null;
  receivedAt: string | null;
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function WpIssueStock({
  projectId,
  workPackageId,
  onHand,
  workers,
  issues,
}: {
  projectId: string;
  workPackageId: string;
  onHand: WpStockRow[];
  workers: { id: string; name: string }[];
  issues: WpIssueRow[];
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [receiver, setReceiver] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issuing, startIssue] = useTransition();

  const selected = onHand.find((o) => o.catalogItemId === item) ?? null;
  const qtyNum = Number(qty);
  const canSubmit = item !== "" && qty !== "" && Number.isFinite(qtyNum) && qtyNum > 0 && !issuing;

  function reset() {
    setItem("");
    setQty("");
    setReceiver("");
    setNote("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startIssue(async () => {
      const result = await issueStock({
        projectId,
        catalogItemId: item,
        workPackageId,
        qty: qtyNum,
        note,
        ...(receiver !== "" ? { receiverWorkerId: receiver } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {onHand.length === 0 ? (
        <p className="text-ink-secondary text-body">ยังไม่มีสต๊อกในสโตร์</p>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
            เบิกวัสดุจากสโตร์
          </button>
        </div>
      )}

      {issues.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {issues.map((i) => (
            <li
              key={i.id}
              className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="text-ink text-body block font-semibold">{i.baseItem}</span>
                <span className="text-ink-secondary text-meta block">
                  {i.specAttrs ? `${i.specAttrs} · ` : ""}
                  ต้นทุน {baht(i.unitCost)} ฿/{i.unit}
                </span>
                {i.receiverName ? (
                  <span className="text-meta mt-0.5 block">
                    <span className={i.receivedAt ? "text-action" : "text-ink-muted"}>
                      {i.receivedAt ? "รับแล้ว" : "รอรับ"}
                    </span>
                    <span className="text-ink-secondary"> · {i.receiverName}</span>
                  </span>
                ) : null}
              </span>
              <span className="text-ink text-body shrink-0 font-semibold">
                {i.qty} {i.unit}
              </span>
              {/* Spec 178 Stream B — undo a wrong เบิก here too (mirrors /store U12).
                  This block only renders for SITE_STAFF (the WP-detail !readOnly
                  gate), which is the reverse_stock_issue gate. */}
              <ConfirmActionButton
                idleLabel="กลับรายการ"
                pendingLabel="กำลังกลับ…"
                confirmMessage={`กลับรายการเบิก ${i.baseItem} ${i.qty} ${i.unit}? ของจะถูกคืนเข้าสโตร์`}
                confirmLabel="ยืนยัน"
                buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
                action={() => reverseStockIssue({ issueId: i.id })}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <BottomSheet open={open} title={STORE_ISSUE_LABEL} onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wp-issue-item" className={LABEL}>
              วัสดุ
            </label>
            <select
              id="wp-issue-item"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              disabled={issuing}
              className={FIELD}
            >
              <option value="">เลือกวัสดุ</option>
              {onHand.map((o) => (
                <option key={o.catalogItemId} value={o.catalogItemId}>
                  {o.baseItem}
                  {o.specAttrs ? ` · ${o.specAttrs}` : ""} (มี {o.qtyOnHand} {o.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wp-issue-qty" className={LABEL}>
              จำนวน
            </label>
            <input
              id="wp-issue-qty"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={issuing}
              className={FIELD}
            />
            {selected ? (
              <p className="text-ink-secondary text-meta">
                มีในมือ {selected.qtyOnHand} {selected.unit}
              </p>
            ) : null}
          </div>

          {/* Custody (spec 177 U7): name the receiver who takes the material; they
              confirm receipt later from the worker portal. Optional. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wp-issue-receiver" className={LABEL}>
              ผู้รับ (ถ้ามี)
            </label>
            <select
              id="wp-issue-receiver"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              disabled={issuing}
              className={FIELD}
            >
              <option value="">ไม่ระบุ</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wp-issue-note" className={LABEL}>
              หมายเหตุ (ถ้ามี)
            </label>
            <input
              id="wp-issue-note"
              type="text"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              disabled={issuing}
              className={FIELD}
            />
          </div>

          {error ? (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {issuing ? "กำลังเบิก…" : "ยืนยันการเบิก"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}

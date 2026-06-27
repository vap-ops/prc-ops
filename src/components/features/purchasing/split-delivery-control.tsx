"use client";

// Spec 135 U3 / ADR 0054 — the "สร้างงวดจัดส่ง" control. Procurement plans a PO's
// deliveries (งวดส่ง): pick the in-transit lines that ship together, give the new
// delivery an ETA / note / cost, and the server moves them into a fresh delivery.
// Back-office only (rendered behind the section's gate); site never creates. The
// default delivery (U1) keeps the 85% one-tap — this is the explicit 15% split.
//
// 'use client' justified: line selection state + a sheet form + submit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { splitPurchaseOrderDelivery } from "@/app/requests/actions";
import { deliverySplitWouldEmptySource } from "@/lib/purchasing/po-deliveries";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { formatPrNumber } from "@/lib/purchasing/format-id";

export interface SplittableLine {
  id: string;
  pr_number: number;
  item_description: string;
  delivery_id: string | null;
}

interface SplitDeliveryControlProps {
  purchaseOrderId: string;
  /** The PO's in-transit member lines — the only ones a split may move. */
  lines: SplittableLine[];
  /** Active (non rejected/cancelled) line count per delivery — the non-empty guard. */
  activeCountByDelivery: Record<string, number>;
}

export function SplitDeliveryControl({
  purchaseOrderId,
  lines,
  activeCountByDelivery,
}: SplitDeliveryControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Most deliveries carry the whole order, so every line starts ticked — untick only
  // the items that go to another งวด (operator UX, 2026-06-17).
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(lines.map((l) => l.id)),
  );
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedLines = lines.filter((l) => checked.has(l.id));
  const count = selectedLines.length;
  const wouldEmpty = deliverySplitWouldEmptySource(selectedLines, activeCountByDelivery);

  // Every open starts with all current lines ticked (the sheet stays mounted across
  // refreshes, so re-seed here rather than relying on the mount-time initial state).
  function openSheet() {
    setChecked(new Set(lines.map((l) => l.id)));
    setEta("");
    setNote("");
    setCost("");
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    if (count === 0) {
      setError("เลือกอย่างน้อยหนึ่งรายการ");
      return;
    }
    if (wouldEmpty) {
      setError("ต้องเหลืออย่างน้อย 1 รายการไว้อีกงวด — เอาบางรายการออกก่อน");
      return;
    }
    const costNum = cost.trim() === "" ? null : Number(cost);
    if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) {
      setError("ค่าจัดส่งไม่ถูกต้อง");
      return;
    }
    startTransition(async () => {
      const result = await splitPurchaseOrderDelivery({
        purchaseOrderId,
        requestIds: [...checked],
        eta: eta || null,
        note: note.trim() || null,
        cost: costNum,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  const inputCls =
    "border-edge-strong bg-card text-ink focus-visible:ring-action w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

  return (
    <>
      <button type="button" onClick={openSheet} className={BUTTON_SECONDARY_MUTED}>
        สร้างงวดจัดส่ง
      </button>

      <BottomSheet open={open} title="สร้างงวดจัดส่งใหม่" onClose={close}>
        <p className="text-ink-secondary text-xs">
          ปกติทุกรายการมาพร้อมกัน จึงติ๊กไว้ทั้งหมด — เอาเฉพาะรายการที่จะแยกไปงวดอื่นออก
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.id} className="border-edge rounded-md border p-2">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={checked.has(l.id)}
                  onChange={() => toggle(l.id)}
                  className="accent-action mt-0.5 size-5 shrink-0 cursor-pointer"
                />
                <span className="min-w-0">
                  <span className="text-ink-muted mr-1.5 font-mono text-xs">
                    {formatPrNumber(l.pr_number)}
                  </span>
                  <span className="text-ink text-sm">{l.item_description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <label className="text-ink-secondary mt-3 block text-xs font-medium">
          กำหนดส่ง (ถ้ามี)
          <input
            type="date"
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            className={`${inputCls} mt-1 min-w-0 appearance-none`}
          />
        </label>
        <label className="text-ink-secondary mt-3 block text-xs font-medium">
          ค่าจัดส่ง (บาท) — ถ้ามี
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className={`${inputCls} mt-1`}
          />
        </label>
        <label className="text-ink-secondary mt-3 block text-xs font-medium">
          หมายเหตุ (ถ้ามี)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${inputCls} mt-1`}
          />
        </label>

        {/* All ticked → can't move the whole source into a new งวด; guide the untick
            rather than show a silently-disabled button. */}
        {wouldEmpty && !error ? (
          <p className="text-ink-secondary mt-3 text-xs">
            ต้องเหลืออย่างน้อย 1 รายการไว้อีกงวด — เอาบางรายการออกก่อน
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={`${INLINE_ALERT_TEXT} mt-3`}>
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || count === 0 || wouldEmpty}
            className={`${BUTTON_PRIMARY} flex-1`}
          >
            {pending ? "กำลังบันทึก…" : `สร้างงวดจัดส่ง (${count})`}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className={BUTTON_SECONDARY_MUTED}
          >
            ยกเลิก
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

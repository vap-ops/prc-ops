"use client";

// Spec 116 / ADR 0044 — the create-PO form. Buyer selected N approved tickets on
// the desktop grid; this sheet collects the supplier, the ETA, and each line's
// price (with a live total), then calls the create_purchase_order RPC via the
// createPurchaseOrder action. The RPC bundles the tickets atomically.
//
// 'use client': controlled inputs (supplier/eta/per-line price) + pending state.
// A child of the (client) ProcurementGrid — all props are client→client, no
// server closures crossing an RSC boundary.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/features/bottom-sheet";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_SELECT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";
import { createPurchaseOrder } from "@/app/requests/actions";
import { purchaseOrderTotal } from "@/lib/purchasing/purchase-order";
import type { SupplierOption } from "@/components/features/purchase-record-form";

export interface CreatePoLine {
  id: string;
  pr_number: number | null;
  item_description: string;
  quantity: number;
  unit: string;
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;

// h-11 (gloved-tap floor) date/number field — mirrors purchase-record-form.
const FIELD_DATE =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 appearance-none border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const FIELD_PRICE =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-28 min-w-0 border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2";

export function CreatePurchaseOrderSheet({
  open,
  lines,
  suppliers,
  onClose,
  onCreated,
}: {
  open: boolean;
  lines: ReadonlyArray<CreatePoLine>;
  suppliers: ReadonlyArray<SupplierOption>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [eta, setEta] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = useMemo(
    () =>
      purchaseOrderTotal(
        lines.map((l) => {
          const raw = (amounts[l.id] ?? "").trim();
          if (raw === "") return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        }),
      ),
    [lines, amounts],
  );

  function handleSubmit() {
    setError(null);
    const parsedLines: Array<{ requestId: string; amount: number | null }> = [];
    for (const l of lines) {
      const raw = (amounts[l.id] ?? "").trim();
      let amount: number | null = null;
      if (raw !== "") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          setError(`ราคาของ "${l.item_description}" ไม่ถูกต้อง`);
          return;
        }
        amount = n;
      }
      parsedLines.push({ requestId: l.id, amount });
    }

    startTransition(async () => {
      const result = await createPurchaseOrder({
        supplierId,
        eta: eta.trim() === "" ? null : eta,
        lines: parsedLines,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated();
      router.refresh();
    });
  }

  return (
    <BottomSheet open={open} title="สร้างใบสั่งซื้อ (PO)" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted text-meta">รวม {lines.length} รายการเป็นใบสั่งซื้อเดียว</p>

        <label htmlFor="po-supplier" className="text-ink text-xs font-medium">
          ผู้ขาย
        </label>
        <select
          id="po-supplier"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          disabled={pending}
          className={FIELD_SELECT}
        >
          <option value="">— เลือกผู้ขาย —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.phone ? ` · ${s.phone}` : ""}
            </option>
          ))}
        </select>

        <label htmlFor="po-eta" className="text-ink text-xs font-medium">
          คาดว่าจะได้รับของ
        </label>
        <input
          id="po-eta"
          type="date"
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          disabled={pending}
          className={FIELD_DATE}
        />

        <div className="rounded-control border-edge divide-edge flex flex-col divide-y border">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-ink text-sm font-medium break-words">{l.item_description}</p>
                <p className="text-ink-muted text-meta">
                  {l.pr_number ? <span className="font-mono">PR-{l.pr_number} · </span> : null}
                  {l.quantity} {l.unit}
                </p>
              </div>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amounts[l.id] ?? ""}
                onChange={(e) => setAmounts((p) => ({ ...p, [l.id]: e.target.value }))}
                disabled={pending}
                placeholder="฿ ราคา"
                aria-label={`ราคาของ ${l.item_description}`}
                className={FIELD_PRICE}
              />
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-ink-muted text-xs">ยอดรวม</span>
          <span className="text-ink text-base font-semibold tabular-nums">{baht(total)}</span>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={BUTTON_SECONDARY}>
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || supplierId === "" || eta.trim() === "" || lines.length === 0}
            className={BUTTON_PRIMARY}
          >
            {pending ? "กำลังสร้าง…" : `สร้าง PO (${lines.length})`}
          </button>
        </div>

        {error ? (
          <p role="alert" className={INLINE_ALERT_TEXT}>
            {error}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}

"use client";

// Spec 182 U1 — price comparison on an approved PR. Back-office records supplier
// quotes (net unit price); this ranks them cheapest-first, shows total (unit ×
// qty) + % over the cheapest, and adds/removes quotes. Money (unit_price) only
// renders here (the page gates the render to back-office; the quotes table is
// back-office-read-only). Pick-winner → PO is U2.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";
import { addPurchaseQuote, removePurchaseQuote } from "@/app/requests/actions";

export type PurchaseQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  note: string | null;
};

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";

function baht(n: number): string {
  return `฿${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function PriceComparison({
  purchaseRequestId,
  quantity,
  unit,
  quotes,
  suppliers,
}: {
  purchaseRequestId: string;
  quantity: number;
  unit: string;
  quotes: PurchaseQuote[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const ranked = useMemo(() => [...quotes].sort((a, b) => a.unitPrice - b.unitPrice), [quotes]);
  const cheapest = ranked[0]?.unitPrice ?? 0;
  const quotedIds = new Set(quotes.map((q) => q.supplierId));
  const available = suppliers.filter((s) => !quotedIds.has(s.id));

  const [supplierId, setSupplierId] = useState("");
  const [priceText, setPriceText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, startAdd] = useTransition();
  const [removing, startRemove] = useTransition();

  const price = priceText.trim() === "" ? Number.NaN : Number(priceText);
  const canAdd = supplierId !== "" && Number.isFinite(price) && price >= 0 && !adding;

  function handleAdd() {
    if (!canAdd) return;
    setError(null);
    startAdd(async () => {
      const r = await addPurchaseQuote({ purchaseRequestId, supplierId, unitPrice: price, note });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSupplierId("");
      setPriceText("");
      setNote("");
      router.refresh();
    });
  }

  function handleRemove(quoteId: string) {
    setError(null);
    startRemove(async () => {
      const r = await removePurchaseQuote({ purchaseRequestId, quoteId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink text-sm font-semibold">
        เปรียบเทียบราคา{ranked.length > 0 ? ` (${ranked.length} เจ้า)` : ""}
      </p>

      {ranked.length === 0 ? (
        <p className="text-ink-secondary text-body">ยังไม่มีใบเสนอราคา — เพิ่มได้ด้านล่าง</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranked.map((q, i) => {
            const total = q.unitPrice * quantity;
            const pct = cheapest > 0 ? Math.round(((q.unitPrice - cheapest) / cheapest) * 100) : 0;
            const isCheapest = i === 0;
            return (
              <li
                key={q.id}
                className={`rounded-control flex items-center gap-3 border px-3 py-2 ${
                  isCheapest ? "border-edge-strong bg-sunk" : "border-edge bg-card"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-sm font-medium">{q.supplierName}</span>
                  <span className="text-ink-secondary text-meta block">
                    {baht(q.unitPrice)}/{unit}
                    {isCheapest ? (
                      <span className="text-done-strong"> · ถูกสุด</span>
                    ) : pct > 0 ? (
                      <span className="text-attn-ink"> · +{pct}%</span>
                    ) : null}
                    {q.note ? ` · ${q.note}` : ""}
                  </span>
                </span>
                <span className="text-ink shrink-0 text-sm font-semibold">{baht(total)}</span>
                <button
                  type="button"
                  aria-label="ลบ"
                  disabled={removing}
                  onClick={() => handleRemove(q.id)}
                  className="text-ink-muted hover:text-ink focus-visible:ring-action shrink-0 rounded-md p-1 focus:outline-none focus-visible:ring-2"
                >
                  <Trash2 aria-hidden className="size-5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="border-edge bg-page rounded-control flex flex-col gap-2 border p-3 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="pq-supplier" className="text-meta text-ink-secondary font-medium">
              ผู้ขาย
            </label>
            <select
              id="pq-supplier"
              aria-label="ผู้ขาย"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={adding}
              className={SELECT}
            >
              <option value="">เลือกผู้ขาย</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-32">
            <label htmlFor="pq-price" className="text-meta text-ink-secondary font-medium">
              ราคาต่อหน่วย
            </label>
            <input
              id="pq-price"
              aria-label="ราคาต่อหน่วย"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              disabled={adding}
              className={FIELD_INPUT}
            />
          </div>
          <button type="button" onClick={handleAdd} disabled={!canAdd} className={BUTTON_PRIMARY}>
            {adding ? "กำลังเพิ่ม…" : "เพิ่ม"}
          </button>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

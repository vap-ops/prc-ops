"use client";

// Spec 182 U1/U2 — price comparison on an approved PR. Back-office records
// supplier quotes (net unit price); this ranks them cheapest-first, shows total
// (unit × qty) + % over the cheapest, and lets a quote be picked → the winning
// supplier + price prefill the create-PO sheet (U2). Money (unit_price) only
// renders here (the page gates the render to back-office; the table is
// back-office-read-only).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Trash2 } from "lucide-react";
import { bahtWithSymbol as baht } from "@/lib/format";
import { CREATE_PO_LABEL } from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";
import { addPurchaseQuote, removePurchaseQuote } from "@/app/requests/actions";
import { QuoteDocAttach } from "@/components/features/purchasing/quote-doc-attach";
import {
  CreatePurchaseOrderSheet,
  type CreatePoLine,
} from "@/components/features/purchasing/create-purchase-order-sheet";
import type { SupplierOption } from "@/lib/purchasing/supplier-option";

export type PurchaseQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  note: string | null;
};

// Spec 182 U3: a past purchase of this PR's catalog item — the NET unit price
// paid (apples-to-apples with the net quotes above), the supplier, and when.
// Newest first (item_price_history orders + caps the list).
export type ItemPriceHistory = {
  supplierName: string;
  netUnitPrice: number;
  quantity: number;
  purchasedAt: string | null;
};

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";

export function PriceComparison({
  purchaseRequestId,
  projectId,
  quantity,
  unit,
  quotes,
  suppliers,
  line,
  history = [],
  quoteDocs = {},
}: {
  purchaseRequestId: string;
  // Spec 182 U4: the PR's project — the pr-attachments storage path prefix.
  projectId: string;
  quantity: number;
  unit: string;
  quotes: PurchaseQuote[];
  suppliers: SupplierOption[];
  // Spec 182 U2: this PR as a PO line, so picking a quote can create the PO.
  line: CreatePoLine;
  // Spec 182 U3: past purchases of this item (newest first) → last-paid line.
  history?: ItemPriceHistory[];
  // Spec 182 U4: quote id → its attached document's signed URL (when present).
  quoteDocs?: Record<string, string>;
}) {
  const router = useRouter();
  const ranked = useMemo(() => [...quotes].sort((a, b) => a.unitPrice - b.unitPrice), [quotes]);
  const cheapest = ranked[0]?.unitPrice ?? 0;
  const quotedIds = new Set(quotes.map((q) => q.supplierId));
  const available = suppliers.filter((s) => !quotedIds.has(s.id));

  const [supplierId, setSupplierId] = useState("");
  const [priceText, setPriceText] = useState("");
  const [note] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, startAdd] = useTransition();
  const [removing, startRemove] = useTransition();

  // Spec 182 U2: the chosen quote (defaults to the cheapest) drives the PO.
  const [pickedId, setPickedId] = useState<string>("");
  const picked = ranked.find((q) => q.id === pickedId) ?? ranked[0] ?? null;
  const [poOpen, setPoOpen] = useState(false);

  // Spec 182 U3: the most recent past purchase of this item is the benchmark.
  const lastPaid = history[0] ?? null;

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
      {/* Spec 182 U3: last-paid benchmark — the most recent net price paid for
          this item, so the quotes can be judged against history. */}
      {lastPaid ? (
        <p className="text-ink-secondary text-meta">
          เคยซื้อล่าสุด {baht(lastPaid.netUnitPrice)}/{unit} จาก {lastPaid.supplierName} ·{" "}
          {history.length} ครั้ง
        </p>
      ) : null}

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
            const isPicked = picked?.id === q.id;
            // Spec 182 U4: the quote's attached document (if one was uploaded).
            const docUrl = quoteDocs[q.id];
            return (
              <li
                key={q.id}
                className={`rounded-control flex items-center gap-3 border px-3 py-2 ${
                  isPicked ? "border-action bg-action-soft" : "border-edge bg-card"
                }`}
              >
                <input
                  type="radio"
                  name="pq-pick"
                  aria-label={`เลือก ${q.supplierName}`}
                  checked={isPicked}
                  onChange={() => setPickedId(q.id)}
                  className="accent-action size-5 shrink-0"
                />
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
                {/* Spec 182 U4: the source quotation — a link if attached, else
                    the per-row attach control (one doc per quote). */}
                {docUrl ? (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`ดูเอกสาร ${q.supplierName}`}
                    className="text-action focus-visible:ring-action inline-flex shrink-0 items-center gap-1 rounded-md p-1 text-xs focus:outline-none focus-visible:ring-2"
                  >
                    <Paperclip aria-hidden className="size-4" />
                    เอกสาร
                  </a>
                ) : (
                  <QuoteDocAttach
                    purchaseRequestId={purchaseRequestId}
                    projectId={projectId}
                    quoteId={q.id}
                  />
                )}
                <button
                  type="button"
                  aria-label="ลบ"
                  // A doc'd quote is append-only and kept for audit → not removable.
                  disabled={removing || Boolean(docUrl)}
                  title={docUrl ? "ลบไม่ได้ — มีเอกสารแนบ (เก็บไว้ตรวจสอบ)" : undefined}
                  onClick={() => handleRemove(q.id)}
                  className="text-ink-muted hover:text-ink focus-visible:ring-action shrink-0 rounded-md p-1 focus:outline-none focus-visible:ring-2 disabled:opacity-40"
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

      {/* Spec 182 U2: create the PO from the picked quote (supplier + net price
          prefilled). With no quotes, the sheet opens blank — same as before. */}
      <button type="button" onClick={() => setPoOpen(true)} className={`${BUTTON_PRIMARY} w-full`}>
        {picked ? `สร้างใบสั่งซื้อจาก ${picked.supplierName}` : CREATE_PO_LABEL}
      </button>
      <CreatePurchaseOrderSheet
        key={picked?.id ?? "blank"}
        open={poOpen}
        lines={[line]}
        suppliers={suppliers}
        defaultSupplierId={picked?.supplierId}
        defaultAmounts={picked ? { [line.id]: String(picked.unitPrice * quantity) } : undefined}
        onClose={() => setPoOpen(false)}
        onCreated={() => setPoOpen(false)}
      />
    </div>
  );
}

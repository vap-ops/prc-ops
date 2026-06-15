"use client";

// Spec 116 + the spec-117 UX round — the create-PO form. Buyer selected N approved
// tickets on the desktop grid; this RIGHT-SIDE panel (desktop, matching the review
// drawer — a bottom sheet was the wrong idiom) collects the supplier, a required
// ETA, and each line's price (live total), then calls create_purchase_order via the
// createPurchaseOrder action. Suppliers can be added inline (no dead-end). On
// success a toast confirms and the grid refreshes.
//
// 'use client': controlled inputs + pending state + inline supplier create. A child
// of the (client) ProcurementGrid — all props are client→client, no server closures.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { BottomSheet } from "@/components/features/bottom-sheet";
import { RadioChip } from "@/components/features/radio-chip";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_INPUT,
  FIELD_SELECT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { createPurchaseOrder, createSupplier } from "@/app/requests/actions";
import { purchaseOrderTotal } from "@/lib/purchasing/purchase-order";
import {
  VAT_RATE,
  type VatMode,
  rateForMode,
  grossFromEntry,
  deriveVatBreakdown,
} from "@/lib/purchasing/vat";
import type { SupplierOption } from "@/components/features/purchase-record-form";

export interface CreatePoLine {
  id: string;
  pr_number: number | null;
  item_description: string;
  quantity: number;
  unit: string;
  wp_code: string | null;
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;

const FIELD_DATE =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 appearance-none border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const FIELD_PRICE =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-28 min-w-0 border px-3 text-right text-sm shadow-xs focus:outline-none focus-visible:ring-2";

export function CreatePurchaseOrderSheet({
  open,
  lines,
  suppliers,
  onClose,
  onCreated,
  onRemoveLine,
}: {
  open: boolean;
  lines: ReadonlyArray<CreatePoLine>;
  suppliers: ReadonlyArray<SupplierOption>;
  onClose: () => void;
  onCreated: () => void;
  // Spec 118 (phone basket): drop a line from the order inside the sheet.
  onRemoveLine?: (id: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState("");
  const [eta, setEta] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // Default exclusive (ก่อน VAT): a PO is created from a quotation, and Thai
  // quotes are usually quoted ex-VAT (net + 7%) — spec 120 review.
  const [vatMode, setVatMode] = useState<VatMode>("exclusive");
  const [orderRef, setOrderRef] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [createdSuppliers, setCreatedSuppliers] = useState<SupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Freshly-created suppliers, deduped against the server-supplied list.
  const allSuppliers = [
    ...suppliers,
    ...createdSuppliers.filter((c) => !suppliers.some((s) => s.id === c.id)),
  ];

  // Spec 119: one VAT mode for the whole PO (one supplier). Each line's entered
  // price resolves to the GROSS via the mode; the total breaks down for display.
  const rate = rateForMode(vatMode);
  const grossTotal = useMemo(
    () =>
      purchaseOrderTotal(
        lines.map((l) => {
          const raw = (amounts[l.id] ?? "").trim();
          if (raw === "") return null;
          const n = Number(raw);
          return Number.isFinite(n) ? grossFromEntry(n, vatMode, rate) : null;
        }),
      ),
    [lines, amounts, vatMode, rate],
  );
  const breakdown = deriveVatBreakdown(grossTotal, rate);

  const ready = supplierId !== "" && eta.trim() !== "" && lines.length > 0;

  function handleAddSupplier() {
    setError(null);
    startTransition(async () => {
      const created = await createSupplier({ name: nameDraft, phone: phoneDraft });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setCreatedSuppliers((prev) => [
        ...prev,
        { id: created.id, name: nameDraft.trim(), phone: phoneDraft.trim() || null },
      ]);
      setSupplierId(created.id);
      setNameDraft("");
      setPhoneDraft("");
    });
  }

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
        amount = grossFromEntry(n, vatMode, rate);
      }
      parsedLines.push({ requestId: l.id, amount });
    }

    startTransition(async () => {
      const result = await createPurchaseOrder({
        supplierId,
        eta: eta.trim() === "" ? null : eta,
        lines: parsedLines,
        vatRate: rate,
        orderRef,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`สร้างใบสั่งซื้อสำเร็จ · ${lines.length} รายการ`);
      onCreated();
      router.refresh();
    });
  }

  return (
    <BottomSheet open={open} side="right" title="สร้างใบสั่งซื้อ (PO)" onClose={onClose}>
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
          {allSuppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.phone ? ` · ${s.phone}` : ""}
            </option>
          ))}
        </select>

        <details>
          <summary className="text-action cursor-pointer text-xs font-medium underline-offset-2 hover:underline">
            เพิ่มผู้ขายใหม่
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="text"
              value={nameDraft}
              maxLength={200}
              onChange={(e) => setNameDraft(e.target.value)}
              disabled={pending}
              placeholder="ชื่อผู้ขาย / ร้านค้า"
              className={FIELD_INPUT}
            />
            <input
              type="tel"
              value={phoneDraft}
              maxLength={50}
              onChange={(e) => setPhoneDraft(e.target.value)}
              disabled={pending}
              placeholder="เบอร์โทร (ไม่บังคับ)"
              className={FIELD_INPUT}
            />
            <button
              type="button"
              onClick={handleAddSupplier}
              disabled={pending || nameDraft.trim().length === 0}
              className={BUTTON_SECONDARY}
            >
              {pending ? "กำลังบันทึก…" : "เพิ่มและเลือก"}
            </button>
          </div>
        </details>

        <div className="flex items-center gap-1.5">
          <label htmlFor="po-eta" className="text-ink text-xs font-medium">
            คาดว่าจะได้รับของ
          </label>
          <span className="bg-attn-soft text-attn-ink rounded-full px-1.5 text-[10px] font-semibold">
            จำเป็น
          </span>
        </div>
        <input
          id="po-eta"
          type="date"
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          disabled={pending}
          className={FIELD_DATE}
        />

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-ink mb-1 text-xs font-medium">
            VAT (ภาษีมูลค่าเพิ่ม {VAT_RATE}%)
          </legend>
          <div className="flex flex-wrap gap-2">
            <RadioChip
              name="po-vat"
              label="ก่อน VAT"
              checked={vatMode === "exclusive"}
              onSelect={() => setVatMode("exclusive")}
            />
            <RadioChip
              name="po-vat"
              label="รวม VAT แล้ว"
              checked={vatMode === "inclusive"}
              onSelect={() => setVatMode("inclusive")}
            />
            <RadioChip
              name="po-vat"
              label="ไม่มี VAT"
              checked={vatMode === "none"}
              onSelect={() => setVatMode("none")}
            />
          </div>
        </fieldset>

        <label htmlFor="po-order-ref" className="text-ink text-xs font-medium">
          เลขที่ใบสั่งซื้อ / อ้างอิงผู้ขาย (ไม่บังคับ)
        </label>
        <input
          id="po-order-ref"
          type="text"
          value={orderRef}
          maxLength={80}
          onChange={(e) => setOrderRef(e.target.value)}
          disabled={pending}
          className={FIELD_INPUT}
        />

        <div className="rounded-control border-edge divide-edge flex flex-col divide-y border">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-ink text-sm font-medium break-words">{l.item_description}</p>
                <p className="text-ink-muted text-meta">
                  {l.pr_number ? <span className="font-mono">PR-{l.pr_number} · </span> : null}
                  {l.wp_code ? <span className="font-mono">{l.wp_code} · </span> : null}
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
              {onRemoveLine ? (
                <button
                  type="button"
                  onClick={() => onRemoveLine(l.id)}
                  disabled={pending}
                  aria-label={`นำ ${l.item_description} ออกจากใบสั่งซื้อ`}
                  className="text-ink-muted hover:text-danger focus-visible:ring-action inline-flex size-11 shrink-0 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2"
                >
                  <X aria-hidden className="size-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          {rate > 0 ? (
            <>
              <div className="text-meta text-ink-muted flex items-baseline justify-between">
                <span>ก่อน VAT</span>
                <span className="tabular-nums">{baht(breakdown.net)}</span>
              </div>
              <div className="text-meta text-ink-muted flex items-baseline justify-between">
                <span>VAT {rate}%</span>
                <span className="tabular-nums">{baht(breakdown.vat)}</span>
              </div>
            </>
          ) : null}
          <div className="flex items-baseline justify-between">
            <span className="text-ink-muted text-xs">ยอดรวม{rate > 0 ? " (รวม VAT)" : ""}</span>
            <span className="text-ink text-base font-semibold tabular-nums">
              {baht(breakdown.gross)}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={BUTTON_SECONDARY}>
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !ready}
            className={BUTTON_PRIMARY}
          >
            {pending ? "กำลังสร้าง…" : `สร้าง PO (${lines.length})`}
          </button>
        </div>

        {!ready && !pending ? (
          <p className="text-ink-muted text-meta text-right">เลือกผู้ขายและระบุวันที่ก่อนสร้าง</p>
        ) : null}

        {error ? (
          <p role="alert" className={INLINE_ALERT_TEXT}>
            {error}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}

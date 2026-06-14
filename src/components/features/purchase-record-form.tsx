"use client";

import { BUTTON_PRIMARY, FIELD_INPUT, FIELD_SELECT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

// 'use client' justification (spec 33): supplier select + inline create
// form + controlled inputs + pending state around the record_purchase
// action. Rendered only for back-office roles (the page gates via
// isBackOfficeRole); the RPC re-enforces server-side.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupplier, recordPurchase } from "@/app/requests/actions";

export interface SupplierOption {
  id: string;
  name: string;
  phone: string | null;
}

interface PurchaseRecordFormProps {
  requestId: string;
  suppliers: SupplierOption[];
}

export function PurchaseRecordForm({ requestId, suppliers }: PurchaseRecordFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState<string>("");
  const [nameDraft, setNameDraft] = useState<string>("");
  const [phoneDraft, setPhoneDraft] = useState<string>("");
  const [orderRef, setOrderRef] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [eta, setEta] = useState<string>("");
  const [createdSuppliers, setCreatedSuppliers] = useState<SupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);

  // After revalidatePath the server prop already contains freshly-created
  // suppliers — dedupe so a created entry never renders twice.
  const allSuppliers = [
    ...suppliers,
    ...createdSuppliers.filter((c) => !suppliers.some((s) => s.id === c.id)),
  ];

  function handleCreateSupplier() {
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
    // A number input with unparseable content reports value "" but flags
    // validity.badInput — without this check the purchase would silently
    // record with NO amount (and corrections are out of scope).
    if (amountRef.current?.validity.badInput) {
      setError("จำนวนเงินไม่ถูกต้อง");
      return;
    }
    const parsedAmount = amount.trim() === "" ? null : Number(amount);
    startTransition(async () => {
      const result = await recordPurchase({
        requestId,
        supplierId,
        orderRef,
        amount: parsedAmount,
        eta: eta.trim() === "" ? null : eta,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <details className="rounded-control border-edge bg-page border px-3 py-2">
      <summary className="text-action cursor-pointer text-xs font-medium underline-offset-2 hover:underline">
        บันทึกการสั่งซื้อ
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label htmlFor={`supplier-${requestId}`} className="text-ink text-xs font-medium">
          ผู้ขาย
        </label>
        <select
          id={`supplier-${requestId}`}
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
              onClick={handleCreateSupplier}
              disabled={pending || nameDraft.trim().length === 0}
              className="border-ink bg-card text-ink hover:bg-sunk focus-visible:ring-action disabled:border-edge-strong disabled:text-ink-muted inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            >
              {pending ? "กำลังบันทึก…" : "เพิ่มและเลือก"}
            </button>
          </div>
        </details>

        <label htmlFor={`order-ref-${requestId}`} className="text-ink text-xs font-medium">
          เลขที่ใบสั่งซื้อ (ไม่บังคับ)
        </label>
        <input
          id={`order-ref-${requestId}`}
          type="text"
          value={orderRef}
          maxLength={80}
          onChange={(e) => setOrderRef(e.target.value)}
          disabled={pending}
          className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
        />

        <label htmlFor={`amount-${requestId}`} className="text-ink text-xs font-medium">
          จำนวนเงิน (บาท, ไม่บังคับ)
        </label>
        <input
          id={`amount-${requestId}`}
          ref={amountRef}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={pending}
          className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
        />

        <label htmlFor={`eta-${requestId}`} className="text-ink text-xs font-medium">
          คาดว่าจะได้รับของ (ไม่บังคับ)
        </label>
        <input
          id={`eta-${requestId}`}
          type="date"
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          disabled={pending}
          className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 appearance-none border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending || supplierId === ""}
          className={BUTTON_PRIMARY}
        >
          {pending ? "กำลังบันทึก…" : "บันทึกการสั่งซื้อ"}
        </button>

        {error ? (
          <p role="alert" className={INLINE_ALERT_TEXT}>
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

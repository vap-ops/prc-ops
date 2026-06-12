"use client";

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
    <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
        บันทึกการสั่งซื้อ
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label htmlFor={`supplier-${requestId}`} className="text-xs font-medium text-zinc-900">
          ผู้ขาย
        </label>
        <select
          id={`supplier-${requestId}`}
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          disabled={pending}
          className="h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-2 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
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
          <summary className="cursor-pointer text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
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
              className="h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            />
            <input
              type="tel"
              value={phoneDraft}
              maxLength={50}
              onChange={(e) => setPhoneDraft(e.target.value)}
              disabled={pending}
              placeholder="เบอร์โทร (ไม่บังคับ)"
              className="h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            />
            <button
              type="button"
              onClick={handleCreateSupplier}
              disabled={pending || nameDraft.trim().length === 0}
              className="inline-flex h-11 items-center justify-center rounded-md border border-slate-900 bg-white px-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-500"
            >
              {pending ? "กำลังบันทึก…" : "เพิ่มและเลือก"}
            </button>
          </div>
        </details>

        <label htmlFor={`order-ref-${requestId}`} className="text-xs font-medium text-zinc-900">
          เลขที่ใบสั่งซื้อ (ไม่บังคับ)
        </label>
        <input
          id={`order-ref-${requestId}`}
          type="text"
          value={orderRef}
          maxLength={80}
          onChange={(e) => setOrderRef(e.target.value)}
          disabled={pending}
          className="h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        />

        <label htmlFor={`amount-${requestId}`} className="text-xs font-medium text-zinc-900">
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
          className="h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        />

        <label htmlFor={`eta-${requestId}`} className="text-xs font-medium text-zinc-900">
          คาดว่าจะได้รับของ (ไม่บังคับ)
        </label>
        <input
          id={`eta-${requestId}`}
          type="date"
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          disabled={pending}
          className="h-11 w-full min-w-0 appearance-none rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending || supplierId === ""}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {pending ? "กำลังบันทึก…" : "บันทึกการสั่งซื้อ"}
        </button>

        {error ? (
          <p role="alert" className="text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

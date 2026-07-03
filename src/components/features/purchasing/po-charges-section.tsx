"use client";

// Spec 260 — the PO-detail charges block: PO-level transport / discount / other
// charges under the line list, with the charges-aware grand total. add is the
// create-gate roles (an inline form: type + amount + VAT mode + note); void is
// manager-only (a destructive confirm per charge naming its type + amount). The
// server actions re-check every gate — this only decides what to render.
//
// 'use client': the add form's controlled inputs + pending state, and the
// per-charge void transitions.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { bahtWithSymbol as baht } from "@/lib/format";
import {
  ADD_PO_CHARGE_LABEL,
  PO_CHARGES_SECTION_LABEL,
  PO_CHARGE_TYPE_LABEL,
  PO_GRAND_TOTAL_LABEL,
} from "@/lib/i18n/labels";
import { RadioChip } from "@/components/features/common/radio-chip";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_INPUT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { VAT_RATE, type VatMode, rateForMode, grossFromEntry } from "@/lib/purchasing/vat";
import { addPurchaseOrderCharge, voidPurchaseOrderCharge } from "@/app/requests/actions";
import type { PoChargeType } from "@/lib/purchasing/purchase-order";

export interface PoChargeView {
  id: string;
  charge_type: PoChargeType;
  amount: number;
  note: string | null;
}

const CHARGE_TYPES: PoChargeType[] = ["transport", "discount", "other"];

export function PoChargesSection({
  poId,
  charges,
  grandTotal,
  canAdd,
  canVoid,
}: {
  poId: string;
  charges: ReadonlyArray<PoChargeView>;
  grandTotal: number;
  canAdd: boolean;
  canVoid: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [chargeType, setChargeType] = useState<PoChargeType>("transport");
  const [amount, setAmount] = useState("");
  const [vatMode, setVatMode] = useState<VatMode>("exclusive");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Per-charge void: which charge's confirm dialog is open, and its pending id.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidPending, startVoid] = useTransition();

  function resetForm() {
    setAmount("");
    setNote("");
    setChargeType("transport");
    setVatMode("exclusive");
    setError(null);
  }

  function submit() {
    setError(null);
    const n = Number(amount.trim());
    if (!Number.isFinite(n) || n <= 0) {
      setError("จำนวนเงินต้องมากกว่า 0");
      return;
    }
    if (chargeType === "other" && note.trim() === "") {
      setError("กรุณาระบุรายละเอียดสำหรับค่าใช้จ่ายอื่น");
      return;
    }
    const rate = rateForMode(vatMode);
    const gross = grossFromEntry(n, vatMode, rate);
    startTransition(async () => {
      const result = await addPurchaseOrderCharge({
        poId,
        chargeType,
        amount: gross,
        vatRate: rate,
        note: note.trim() === "" ? null : note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      setAdding(false);
      router.refresh();
    });
  }

  const confirmCharge = confirmId ? (charges.find((c) => c.id === confirmId) ?? null) : null;

  return (
    <div className="rounded-card border-edge bg-card shadow-card border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ink text-base font-semibold">{PO_CHARGES_SECTION_LABEL}</h2>
        {canAdd && !adding ? (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setAdding(true);
            }}
            className="text-action text-sm font-medium underline-offset-2 hover:underline"
          >
            + {ADD_PO_CHARGE_LABEL}
          </button>
        ) : null}
      </div>

      {charges.length > 0 ? (
        <ul className="divide-edge mt-3 flex flex-col divide-y">
          {charges.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-ink text-sm font-medium">
                  {PO_CHARGE_TYPE_LABEL[c.charge_type]}
                </p>
                {c.note ? <p className="text-ink-secondary truncate text-xs">{c.note}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`text-sm tabular-nums ${c.charge_type === "discount" ? "text-danger" : "text-ink"}`}
                >
                  {c.charge_type === "discount" ? `−${baht(c.amount)}` : baht(c.amount)}
                </span>
                {canVoid ? (
                  <button
                    type="button"
                    onClick={() => {
                      setVoidError(null);
                      setConfirmId(c.id);
                    }}
                    disabled={voidPending}
                    aria-label={`ลบ${PO_CHARGE_TYPE_LABEL[c.charge_type]} ${baht(c.amount)}`}
                    className="text-ink-muted hover:text-danger focus-visible:ring-action inline-flex size-8 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 disabled:opacity-50"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-secondary mt-3 text-xs">ยังไม่มีค่าใช้จ่ายระดับใบสั่งซื้อ</p>
      )}

      {voidError ? (
        <p role="alert" className={`${INLINE_ALERT_TEXT} mt-2`}>
          {voidError}
        </p>
      ) : null}

      {/* Charges-aware grand total. */}
      <div className="border-edge-strong mt-3 flex items-baseline justify-between border-t pt-3">
        <span className="text-ink text-sm font-medium">{PO_GRAND_TOTAL_LABEL}</span>
        <span className="text-ink text-base font-semibold tabular-nums">{baht(grandTotal)}</span>
      </div>

      {canAdd && adding ? (
        <div className="border-edge-strong mt-4 flex flex-col gap-3 border-t pt-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-ink mb-1 text-xs font-medium">ประเภท</legend>
            <div className="flex flex-wrap gap-2">
              {CHARGE_TYPES.map((t) => (
                <RadioChip
                  key={t}
                  name="po-charge-type"
                  label={PO_CHARGE_TYPE_LABEL[t]}
                  checked={chargeType === t}
                  onSelect={() => setChargeType(t)}
                />
              ))}
            </div>
          </fieldset>

          <label htmlFor="po-charge-amount" className="text-ink text-xs font-medium">
            จำนวนเงิน
          </label>
          <input
            id="po-charge-amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            placeholder="฿ จำนวนเงิน"
            className={FIELD_INPUT}
          />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-ink mb-1 text-xs font-medium">
              VAT (ภาษีมูลค่าเพิ่ม {VAT_RATE}%)
            </legend>
            <div className="flex flex-wrap gap-2">
              <RadioChip
                name="po-charge-vat"
                label="ก่อน VAT"
                checked={vatMode === "exclusive"}
                onSelect={() => setVatMode("exclusive")}
              />
              <RadioChip
                name="po-charge-vat"
                label="รวม VAT แล้ว"
                checked={vatMode === "inclusive"}
                onSelect={() => setVatMode("inclusive")}
              />
              <RadioChip
                name="po-charge-vat"
                label="ไม่มี VAT"
                checked={vatMode === "none"}
                onSelect={() => setVatMode("none")}
              />
            </div>
          </fieldset>

          <label htmlFor="po-charge-note" className="text-ink text-xs font-medium">
            รายละเอียด{chargeType === "other" ? "" : " (ไม่บังคับ)"}
          </label>
          <input
            id="po-charge-note"
            type="text"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            placeholder={chargeType === "other" ? "ระบุค่าใช้จ่าย" : "หมายเหตุ"}
            className={FIELD_INPUT}
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              disabled={pending}
              className={BUTTON_SECONDARY}
            >
              ยกเลิก
            </button>
            <button type="button" onClick={submit} disabled={pending} className={BUTTON_PRIMARY}>
              {pending ? "กำลังบันทึก…" : ADD_PO_CHARGE_LABEL}
            </button>
          </div>

          {error ? (
            <p role="alert" className={INLINE_ALERT_TEXT}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmCharge !== null}
        message={
          confirmCharge
            ? `ลบ${PO_CHARGE_TYPE_LABEL[confirmCharge.charge_type]} ${baht(confirmCharge.amount)} ออกจากใบสั่งซื้อหรือไม่?`
            : ""
        }
        confirmLabel="ยืนยันลบ"
        onConfirm={() => {
          const id = confirmId;
          setConfirmId(null);
          if (!id) return;
          setVoidError(null);
          startVoid(async () => {
            const result = await voidPurchaseOrderCharge({ chargeId: id, poId });
            if (!result.ok) {
              setVoidError(result.error);
              return;
            }
            router.refresh();
          });
        }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

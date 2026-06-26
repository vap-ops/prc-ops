"use client";

// Spec 209 U2 — the WP→store RETURN control on each issued line. Distinct from the
// mistake-undo ("แก้รายการที่บันทึกผิด"): this returns a PARTIAL qty of issued material
// back to the store at the issue cost (offcuts/leftovers). Two-step: a button reveals
// a qty field (default = remaining returnable) + confirm. Hidden once nothing is left
// to return. 'use client': owns the qty input, pending state, and a post-action refresh.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { BUTTON_SECONDARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";
import { STORE_RETURN_TO_STORE_LABEL } from "@/lib/i18n/labels";
import { returnStockToStore } from "@/app/store/actions";

export function ReturnToStoreControl({
  issueId,
  baseItem,
  unit,
  remaining,
}: {
  issueId: string;
  baseItem: string;
  unit: string;
  /** Issued qty minus what has already been returned. */
  remaining: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qtyText, setQtyText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startReturn] = useTransition();

  // Nothing left to return — don't offer the control.
  if (remaining <= 0) return null;

  const qty = qtyText.trim().length === 0 ? Number.NaN : Number.parseFloat(qtyText);
  const canSubmit = !pending && Number.isFinite(qty) && qty > 0 && qty <= remaining;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startReturn(async () => {
      const result = await returnStockToStore({ issueId, qty });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setQtyText("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQtyText(String(remaining));
          setError(null);
        }}
        className={`${BUTTON_SECONDARY} shrink-0`}
      >
        {STORE_RETURN_TO_STORE_LABEL}
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`จำนวนที่คืน ${baseItem}`}
          value={qtyText}
          onChange={(e) => {
            setQtyText(e.target.value);
            setError(null);
          }}
          disabled={pending}
          className={`${FIELD_INPUT} w-20`}
          placeholder={String(remaining)}
        />
        <span className="text-ink-secondary text-meta">{unit}</span>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`${BUTTON_SECONDARY} shrink-0`}
        >
          {pending ? "กำลังคืน…" : "ยืนยันคืน"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="text-ink-muted text-meta underline"
        >
          ยกเลิก
        </button>
      </div>
      <span className="text-ink-muted text-meta">คืนได้ไม่เกิน {remaining}</span>
      {error ? (
        <div role="alert" className={`${INLINE_ERROR} text-meta`}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

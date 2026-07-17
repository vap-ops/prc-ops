"use client";

// Spec 324 U5 — the back-office receipt-correction form. 'use client': the
// true-count field state, the reject-note reveal, and the submit transition +
// router.refresh. ONE panel, two modes:
//   * decide — reviewing an SA flag on the /store/corrections queue. The true
//     count prefills the SA's proposed qty; APPROVE relays
//     decideReceiptCorrectionRequest(approve:true, trueQty); REJECT reveals a
//     required note then relays approve:false + note (closes the receipt to
//     further flags).
//   * direct — a BO trues a receipt with no flag (from the receipt row); a
//     required reason accompanies the true count; SAVE relays correctStockReceipt.
// A fresh-pool refusal (errcode 22023, mapped in the action) surfaces the guide
// copy — the pool was already drawn, so a partial receipt-cost correction is no
// longer exact (§5).

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctStockReceipt, decideReceiptCorrectionRequest } from "@/app/store/actions";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  BUTTON_DANGER_OUTLINE_COMPACT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";
import {
  RECEIPT_CORRECTION_TRUE_QTY_LABEL,
  RECEIPT_CORRECTION_APPROVE_LABEL,
  RECEIPT_CORRECTION_REJECT_LABEL,
  RECEIPT_CORRECTION_CONFIRM_REJECT_LABEL,
  RECEIPT_CORRECTION_SAVE_LABEL,
  RECEIPT_CORRECTION_REASON_LABEL,
  RECEIPT_CORRECTION_REJECT_NOTE_LABEL,
  RECEIPT_CORRECTION_FLAGGED_QTY_HINT,
  RECEIPT_CORRECTION_ORDERED_HINT,
  RECEIPT_CORRECTION_FAILED,
} from "@/lib/i18n/labels";

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

type CommonProps = {
  /** The qty booked on the receipt (ordered) — the number trued DOWN from. */
  orderedQty: number;
  unit: string;
  /** Fired after a successful apply/reject (e.g. to close a host sheet). The
   *  server actions revalidate the queue + project store themselves. */
  onDone?: () => void;
};

export type ReceiptCorrectionPanelProps = CommonProps &
  (
    | { mode: "direct"; receiptId: string }
    | { mode: "decide"; requestId: string; proposedQty: number }
  );

export function ReceiptCorrectionPanel(props: ReceiptCorrectionPanelProps) {
  const { orderedQty, unit, onDone } = props;
  const router = useRouter();
  const toast = useToast();
  // Unique field ids so several panels (the queue renders one per pending flag)
  // don't collide on a shared id.
  const uid = useId();
  const trueQtyId = `rc-true-${uid}`;
  const reasonId = `rc-reason-${uid}`;
  const noteId = `rc-note-${uid}`;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [trueQty, setTrueQty] = useState<string>(
    props.mode === "decide" ? String(props.proposedQty) : "",
  );
  const [reason, setReason] = useState<string>("");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState<string>("");

  // §5.2 range: 0 <= true < ordered (removing the surplus must be > 0). Enforced
  // in-RPC too; this is the fast client refusal.
  function parseTrueQty(): number | null {
    const q = Number(trueQty);
    if (trueQty.trim() === "" || !Number.isFinite(q) || q < 0 || q >= orderedQty) return null;
    return q;
  }

  function apply() {
    const q = parseTrueQty();
    if (q === null) {
      setError(RECEIPT_CORRECTION_FAILED);
      return;
    }
    if (props.mode === "direct" && reason.trim() === "") {
      setError(RECEIPT_CORRECTION_FAILED);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result =
        props.mode === "decide"
          ? await decideReceiptCorrectionRequest({
              requestId: props.requestId,
              approve: true,
              trueQty: q,
            })
          : await correctStockReceipt({ receiptId: props.receiptId, trueQty: q, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("แก้ไขจำนวนรับแล้ว");
      router.refresh();
      onDone?.();
    });
  }

  function reject() {
    if (props.mode !== "decide") return;
    if (note.trim() === "") {
      setError(RECEIPT_CORRECTION_FAILED);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await decideReceiptCorrectionRequest({
        requestId: props.requestId,
        approve: false,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ปฏิเสธแล้ว");
      router.refresh();
      onDone?.();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={trueQtyId} className={LABEL}>
          {RECEIPT_CORRECTION_TRUE_QTY_LABEL}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={trueQtyId}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={trueQty}
            onChange={(e) => setTrueQty(e.target.value)}
            disabled={pending || rejecting}
            className={FIELD}
          />
          <span className="text-ink-secondary text-meta shrink-0">
            {unit} / {RECEIPT_CORRECTION_ORDERED_HINT} {orderedQty}
          </span>
        </div>
        {props.mode === "decide" ? (
          <p className="text-ink-secondary text-meta">
            {RECEIPT_CORRECTION_FLAGGED_QTY_HINT} {props.proposedQty} {unit}
          </p>
        ) : null}
      </div>

      {props.mode === "direct" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={reasonId} className={LABEL}>
            {RECEIPT_CORRECTION_REASON_LABEL}
          </label>
          <input
            id={reasonId}
            type="text"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            className={FIELD}
          />
        </div>
      ) : null}

      {rejecting ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className={LABEL}>
            {RECEIPT_CORRECTION_REJECT_NOTE_LABEL}
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={1000}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            className={FIELD}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}

      {rejecting ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={reject}
            className={BUTTON_DANGER_OUTLINE_COMPACT}
          >
            {RECEIPT_CORRECTION_CONFIRM_REJECT_LABEL}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setRejecting(false);
              setError(null);
            }}
            className={BUTTON_SECONDARY_COMPACT}
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={apply}
            className={BUTTON_PRIMARY_COMPACT}
          >
            {props.mode === "decide"
              ? RECEIPT_CORRECTION_APPROVE_LABEL
              : RECEIPT_CORRECTION_SAVE_LABEL}
          </button>
          {props.mode === "decide" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setRejecting(true);
                setError(null);
              }}
              className={BUTTON_SECONDARY_COMPACT}
            >
              {RECEIPT_CORRECTION_REJECT_LABEL}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

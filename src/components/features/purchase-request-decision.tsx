"use client";

// 'use client' justification (feature spec 09, ADR 0022):
//
// Per-row Approve / Reject control on the /requests pending rows
// (spec 19 §4 merged the old /pm/requests queue there). Owns the
// comment textarea state, the decision-in-flight state, and the inline
// error strip. Mirrors DisplayNameForm in shape (useState +
// useTransition + pure validator + router.refresh()).
//
// The reject-needs-comment rule is checked client-side via the pure
// isDecisionCommentValid predicate so the button shows as disabled
// without a round-trip. The server action runs the same predicate, so
// even an offline-edited DOM submission is refused.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decidePurchaseRequest } from "@/app/requests/actions";
import {
  isDecisionCommentValid,
  type PurchaseDecision,
} from "@/lib/purchasing/validate-purchase-request";

interface PurchaseRequestDecisionProps {
  requestId: string;
}

export function PurchaseRequestDecision({ requestId }: PurchaseRequestDecisionProps) {
  const router = useRouter();
  const [comment, setComment] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<PurchaseDecision | null>(null);
  const [submitting, startSubmit] = useTransition();

  const rejectCommentValid = isDecisionCommentValid("rejected", comment);
  const canApprove = !submitting;
  const canReject = !submitting && rejectCommentValid;

  function handleDecide(decision: PurchaseDecision) {
    if (decision === "rejected" && !rejectCommentValid) {
      setError("ต้องใส่ความเห็นเมื่อไม่อนุมัติ");
      return;
    }
    setError(null);
    setPendingDecision(decision);
    startSubmit(async () => {
      const result = await decidePurchaseRequest({
        id: requestId,
        decision,
        comment: decision === "rejected" ? comment : null,
      });
      if (!result.ok) {
        setError(result.error);
        setPendingDecision(null);
        return;
      }
      // On success, the row leaves the pending band (status is no
      // longer 'requested'), so router.refresh() re-sorts it below.
      // We don't clear local state — the component is about to unmount.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="ความเห็นประกอบการพิจารณา"
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          setError(null);
        }}
        disabled={submitting}
        rows={2}
        maxLength={1000}
        placeholder="ความเห็น (ต้องใส่เมื่อไม่อนุมัติ)…"
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
      />

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => handleDecide("rejected")}
          disabled={!canReject}
          className="inline-flex h-11 items-center justify-center rounded-md bg-red-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {submitting && pendingDecision === "rejected" ? "กำลังบันทึก…" : "ไม่อนุมัติ"}
        </button>
        <button
          type="button"
          onClick={() => handleDecide("approved")}
          disabled={!canApprove}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {submitting && pendingDecision === "approved" ? "กำลังบันทึก…" : "อนุมัติ"}
        </button>
      </div>
    </div>
  );
}

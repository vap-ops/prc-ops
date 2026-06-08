"use client";

// 'use client' justification (feature spec 09, ADR 0022):
//
// Per-row Approve / Reject control on /pm/requests. Owns the comment
// textarea state, the decision-in-flight state, and the inline error
// strip. Mirrors DisplayNameForm in shape (useState + useTransition +
// pure validator + router.refresh()).
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
      setError("A comment is required when rejecting.");
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
      // On success, the row leaves the queue (status is no longer
      // 'requested'), so router.refresh() drops it from /pm/requests.
      // We don't clear local state — the component is about to unmount.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="Decision comment"
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          setError(null);
        }}
        disabled={submitting}
        rows={2}
        maxLength={1000}
        placeholder="Comment (required to reject)…"
        className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
      />

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => handleDecide("rejected")}
          disabled={!canReject}
          className="inline-flex h-9 items-center justify-center rounded-md border border-red-900/70 bg-red-950/40 px-3 text-sm font-medium text-red-200 transition-colors hover:bg-red-950/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && pendingDecision === "rejected" ? "Rejecting…" : "Reject"}
        </button>
        <button
          type="button"
          onClick={() => handleDecide("approved")}
          disabled={!canApprove}
          className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-100 px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && pendingDecision === "approved" ? "Approving…" : "Approve"}
        </button>
      </div>
    </div>
  );
}

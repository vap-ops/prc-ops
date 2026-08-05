"use client";

// Spec 380 U6 — the accounting doc waiver on the money-review voucher.
//
// This is the last rung of the RD fallback ladder (§2): every other rung asks
// someone for a document, this one records that no document is coming. It is
// accounting-only (decision ③), audited on both directions by the DEFINER RPCs,
// and it discharges the order from the ไม่มีเอกสาร queue — so the panel states
// the consequence where the decision is made rather than leaving it in a spec.
//
// Client component so a DB refusal renders in place: a money decision that
// silently does nothing is indistinguishable from a crash.

import { useState, useTransition } from "react";
import type { ReviewActionResult } from "@/app/accounting/review/[source]/[id]/actions";
import type { Database } from "@/lib/db/database.types";
import {
  DOC_WAIVED_LABEL,
  DOC_WAIVER_ACTION,
  DOC_WAIVER_CONSEQUENCE,
  DOC_WAIVER_NOTE_FIELD,
  DOC_WAIVER_REASON_FIELD,
  DOC_WAIVER_REASON_LABEL,
  DOC_WAIVER_UNDO_ACTION,
  formatThaiDate,
} from "@/lib/i18n/labels";
import { FIELD_INPUT, BUTTON_SECONDARY } from "@/lib/ui/classes";

type WaiverReason = Database["public"]["Enums"]["purchase_doc_waiver_reason"];

export interface PurchaseDocWaiverView {
  reason: WaiverReason;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

interface Props {
  purchaseRequestId: string;
  waiver: PurchaseDocWaiverView | null;
  waive: (id: string, reason: string, note: string) => Promise<ReviewActionResult>;
  unwaive: (id: string) => Promise<ReviewActionResult>;
}

const REASON_ENTRIES = Object.entries(DOC_WAIVER_REASON_LABEL) as [WaiverReason, string][];

export function PurchaseDocWaiverPanel({ purchaseRequestId, waiver, waive, unwaive }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<WaiverReason>("vendor_refused");
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<ReviewActionResult>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="bg-danger-soft text-danger-ink rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {waiver ? (
        <>
          <p className="text-foreground text-sm font-medium">
            {DOC_WAIVED_LABEL} — {DOC_WAIVER_REASON_LABEL[waiver.reason]}
          </p>
          <p className="text-muted-foreground text-xs">
            {waiver.createdByName ?? "—"} · {formatThaiDate(waiver.createdAt)}
            {waiver.note ? ` · ${waiver.note}` : ""}
          </p>
          <div>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={pending}
              onClick={() => run(() => unwaive(purchaseRequestId))}
            >
              {DOC_WAIVER_UNDO_ACTION}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">{DOC_WAIVER_CONSEQUENCE}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{DOC_WAIVER_REASON_FIELD}</span>
            <select
              className={FIELD_INPUT}
              value={reason}
              onChange={(e) => setReason(e.target.value as WaiverReason)}
            >
              {REASON_ENTRIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{DOC_WAIVER_NOTE_FIELD}</span>
            <input className={FIELD_INPUT} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={pending}
              onClick={() => run(() => waive(purchaseRequestId, reason, note))}
            >
              {DOC_WAIVER_ACTION}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

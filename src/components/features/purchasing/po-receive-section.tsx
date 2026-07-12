"use client";

// Spec 134 U5 / ADR 0053 — the PO-level receive checklist. The in-transit lines of a
// PO render as a checklist with EVERYTHING TICKED by default: Case A (~85%, whole PO
// arrived) = confirm; Case B (~14%, some items wait for restock) = untick the waiting
// lines and receive the rest (they stay on_route, the PO shows partially_received).
// The within-ticket split (U3, ~1%) is the quiet "แบ่งรับบางส่วน" link per line.
//
// 'use client' justified: selection state + submit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { receivePoLines } from "@/app/requests/actions";
import { PartialReceiveControl } from "@/components/features/purchasing/partial-receive-control";
import { BUTTON_PRIMARY, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import { RECEIVE_TO_STORE_LABEL } from "@/lib/i18n/labels";
import { withBackFrom } from "@/lib/nav/back-href";

export interface ReceivableLine {
  id: string;
  pr_number: number;
  item_description: string;
  quantity: number;
  unit: string;
  /** Per-line amount — back office only (else null; hides the split amount field). */
  amount: number | null;
}

export function PoReceiveSection({
  lines,
  backFrom,
  submitBlockedReason,
}: {
  lines: ReceivableLine[];
  /**
   * Back-nav sweep 2026-07-11: the PO page's own path, threaded as ?from so a
   * checklist line's request detail backs to the PO — matching the sibling
   * member-list links on the same page.
   */
  backFrom?: string;
  /**
   * Spec 308: the delivery receive page gates confirm on the required truck
   * photo — when set, the submit button disables and this reason renders.
   * Undefined = the original PO-page behavior, untouched.
   */
  submitBlockedReason?: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(lines.map((l) => l.id)),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = checked.size;

  function submit() {
    setError(null);
    if (count === 0) {
      setError("เลือกอย่างน้อยหนึ่งรายการที่มาถึงแล้ว");
      return;
    }
    startTransition(async () => {
      const result = await receivePoLines({
        requestIds: [...checked],
        deliveryNote: note.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-card border-edge bg-card shadow-card border p-4">
      <h2 className="text-ink text-base font-semibold">{RECEIVE_TO_STORE_LABEL}</h2>
      <p className="text-ink-secondary mt-0.5 text-xs">
        เลือกไว้ทั้งหมดแล้ว — หากบางรายการยังไม่มาถึง ให้เอาเครื่องหมายออก แล้วรับเฉพาะที่มาถึง
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {lines.map((l) => (
          <li key={l.id} className="border-edge rounded-md border p-2">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={checked.has(l.id)}
                onChange={() => toggle(l.id)}
                aria-label={`รับ ${l.item_description}`}
                className="accent-action mt-0.5 size-5 shrink-0 cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={
                    backFrom ? withBackFrom(`/requests/${l.id}`, backFrom) : `/requests/${l.id}`
                  }
                  className="hover:underline focus:outline-none focus-visible:underline"
                >
                  <span className="text-ink-muted mr-1.5 font-mono text-xs">
                    {formatPrNumber(l.pr_number)}
                  </span>
                  <span className="text-ink text-sm">{l.item_description}</span>
                  <span className="text-ink-secondary text-xs">
                    {" "}
                    · {l.quantity} {l.unit}
                  </span>
                </Link>
              </div>
            </div>
            <div className="mt-1 pl-7">
              <PartialReceiveControl
                purchaseRequestId={l.id}
                orderedQty={l.quantity}
                unit={l.unit}
                amount={l.amount}
                subtle
                triggerLabel="แบ่งรับบางส่วน (ของยังมาไม่ครบชิ้น)"
              />
            </div>
          </li>
        ))}
      </ul>
      <label className="text-ink-secondary mt-3 block text-xs font-medium">
        หมายเหตุการรับของ (ถ้ามี)
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="border-edge-strong bg-card text-ink focus-visible:ring-action mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
        />
      </label>
      {error ? (
        <p role="alert" className={`${INLINE_ALERT_TEXT} mt-2`}>
          {error}
        </p>
      ) : null}
      {submitBlockedReason ? (
        <p className="text-attn-ink mt-2 text-xs font-medium">{submitBlockedReason}</p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={pending || count === 0 || submitBlockedReason != null}
        className={`${BUTTON_PRIMARY} mt-3 w-full`}
      >
        {pending ? "กำลังบันทึก…" : `${RECEIVE_TO_STORE_LABEL}ที่เลือก (${count})`}
      </button>
    </div>
  );
}

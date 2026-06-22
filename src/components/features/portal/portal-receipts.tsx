"use client";

// Spec 177 U8 — the worker-portal receipt confirm (closes the custody handshake).
// A bound worker sees the items issued TO them that are still pending receipt and
// taps "ได้รับแล้ว" to attest. 'use client': the per-row confirm transition + refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BUTTON_PRIMARY, CARD, INLINE_ERROR } from "@/lib/ui/classes";
import { EmptyNotice } from "@/components/features/common/notices";
import { confirmStockIssue } from "@/app/store/actions";

export type PortalReceipt = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  wpLabel: string;
};

export function PortalReceipts({ receipts }: { receipts: PortalReceipt[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, startConfirm] = useTransition();

  function handleConfirm(id: string) {
    setError(null);
    setPendingId(id);
    startConfirm(async () => {
      const result = await confirmStockIssue({ issueId: id });
      if (!result.ok) {
        setError(result.error);
        setPendingId(null);
        return;
      }
      router.refresh();
    });
  }

  if (receipts.length === 0) {
    return <EmptyNotice>ไม่มีรายการรอรับ</EmptyNotice>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
      <ul className="flex flex-col gap-3">
        {receipts.map((r) => (
          <li key={r.id} className={`${CARD} flex items-center gap-3`}>
            <span className="min-w-0 flex-1">
              <span className="text-ink text-body block font-semibold">{r.baseItem}</span>
              <span className="text-ink-secondary text-meta block">
                {r.specAttrs ? `${r.specAttrs} · ` : ""}
                {r.wpLabel}
              </span>
              <span className="text-ink text-meta mt-0.5 block font-medium">
                {r.qty} {r.unit}
              </span>
            </span>
            <button
              type="button"
              disabled={confirming && pendingId === r.id}
              onClick={() => handleConfirm(r.id)}
              className={`${BUTTON_PRIMARY} shrink-0`}
            >
              {confirming && pendingId === r.id ? "กำลังยืนยัน…" : "ได้รับแล้ว"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

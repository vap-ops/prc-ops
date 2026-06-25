"use client";

// Spec 204 — per-row retention actions. mark-due needs a date, so it is its own
// controlled control; release is the shared ConfirmActionButton (it moves money +
// posts GL, so it confirms). The predicates mirror the RPC guards so a row only
// ever offers the legal next step.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { BUTTON_SECONDARY_COMPACT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { canMarkRetentionDue, canReleaseRetention } from "@/lib/accounting/billing-actions";
import { markRetentionDue, releaseRetention } from "./actions";

export function RetentionRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const showDue = canMarkRetentionDue(status);
  const showRelease = canReleaseRetention(status);
  if (!showDue && !showRelease) return null;

  function markDue() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      setError("เลือกวันครบกำหนด");
      return;
    }
    setError(null);
    start(async () => {
      const r = await markRetentionDue(id, due);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="border-edge mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
      {showDue ? (
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`due-${id}`} className="text-ink-muted text-xs">
              วันครบกำหนด
            </label>
            <Input
              id={`due-${id}`}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              disabled={pending}
              className="border-edge-strong bg-card text-ink h-9"
            />
          </div>
          <button
            type="button"
            onClick={markDue}
            disabled={pending}
            className={BUTTON_SECONDARY_COMPACT}
          >
            {pending ? "กำลังทำรายการ…" : "ครบกำหนด"}
          </button>
        </div>
      ) : null}

      {showRelease ? (
        <ConfirmActionButton
          idleLabel="คืนเงินประกัน"
          pendingLabel="กำลังคืน…"
          confirmMessage="คืนเงินประกันผลงานก้อนนี้? ระบบจะลงบัญชีให้ (เครดิตเงินสด/ธนาคาร)"
          confirmLabel="คืนเงิน"
          buttonClassName={BUTTON_SECONDARY_COMPACT}
          action={releaseRetention.bind(null, id)}
        />
      ) : null}

      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

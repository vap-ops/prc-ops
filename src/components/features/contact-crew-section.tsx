"use client";

// Spec 90 — ContactCrewSection: the crew (DC workers) under a contractor, shown
// on its detail page, with an add form. Adding reuses createWorker
// (worker_type='dc', this contractor as parent). A day rate is required at
// creation (the create_worker RPC needs it); rates are never DISPLAYED here —
// money stays on /workers (PM-only). The detail page is PM-gated.
//
// 'use client' justification: the add form + busy state.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createWorker } from "@/app/workers/actions";
import { BUTTON_PRIMARY_COMPACT, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";

export function ContactCrewSection({
  contractorId,
  crew,
}: {
  contractorId: string;
  crew: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    const dayRate = Number(rate);
    const result = await createWorker({
      name,
      workerType: "dc",
      dayRate: Number.isFinite(dayRate) ? dayRate : -1,
      contractorId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setRate("");
    toast.success("บันทึกแล้ว");
    router.refresh();
  }

  return (
    <section className={CARD}>
      <p className="text-sm font-semibold text-zinc-900">ทีมงาน (DC)</p>
      {crew.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {crew.map((c) => (
            <li key={c.id} className="text-sm text-zinc-900">
              {c.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-zinc-500">ยังไม่มีทีมงาน</p>
      )}
      <div className="mt-3 border-t border-zinc-200 pt-3">
        <p className="text-xs font-medium text-zinc-700">เพิ่มคนงาน DC</p>
        <label className="mt-2 block text-sm text-zinc-700">
          ชื่อ
          <input
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            className={FIELD_STACKED}
          />
        </label>
        <label className="mt-2 block text-sm text-zinc-700">
          ค่าแรงต่อวัน (บาท)
          <input
            value={rate}
            inputMode="decimal"
            disabled={busy}
            onChange={(e) => setRate(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
        {error ? (
          <p role="alert" className={`mt-2 ${INLINE_ALERT_TEXT}`}>
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || name.trim().length === 0 || rate.trim().length === 0}
          onClick={() => void add()}
          className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
        >
          เพิ่มคนงาน
        </button>
      </div>
    </section>
  );
}

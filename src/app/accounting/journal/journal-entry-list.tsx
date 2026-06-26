"use client";

// Spec G8 — recent manual entries with a per-entry กลับรายการ (reverse) control.
// 'use client' justified: the reverse action's submit pending + inline error +
// router.refresh. canReverseJournalEntry mirrors the reverse_journal_entry RPC
// guard so the control only shows when the entry is legally reversible (posted +
// not already reversed); a reversed entry shows a badge instead. The RPC beneath
// reverseManualJournal is the load-bearing guard.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyNotice } from "@/components/features/common/notices";
import { CARD, INLINE_ERROR } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { canReverseJournalEntry } from "@/lib/accounting/journal";
import type { ManualJournalEntryView } from "@/lib/accounting/load-manual-journals";
import { reverseManualJournal } from "./actions";

export function JournalEntryList({ entries }: { entries: ManualJournalEntryView[] }) {
  if (entries.length === 0) {
    return <EmptyNotice>ยังไม่มีรายการที่บันทึกด้วยตนเอง</EmptyNotice>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {entries.map((e) => (
        <JournalEntryCard key={e.id} entry={e} />
      ))}
    </ul>
  );
}

function JournalEntryCard({ entry }: { entry: ManualJournalEntryView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // The original entry stays 'posted' after reversal (append-only); reversibility
  // is gated on its status AND whether a reversal already points back at it.
  const reversible = canReverseJournalEntry(entry.status, entry.alreadyReversed);

  function reverse() {
    if (pending) return;
    setError(null);
    start(async () => {
      const result = await reverseManualJournal({ entryId: entry.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink text-sm font-semibold">
            #{entry.entryNo} · {formatThaiDate(entry.entryDate)}
          </p>
          {entry.memo ? <p className="text-ink-secondary text-xs">{entry.memo}</p> : null}
        </div>
        {entry.alreadyReversed ? (
          <span className="rounded-control bg-sunk text-ink-muted shrink-0 px-2 py-0.5 text-xs font-medium">
            กลับรายการแล้ว
          </span>
        ) : reversible ? (
          <button
            type="button"
            onClick={reverse}
            disabled={pending}
            className="text-attn-ink shrink-0 text-sm font-medium disabled:opacity-40"
          >
            {pending ? "กำลังกลับรายการ…" : "กลับรายการ"}
          </button>
        ) : null}
      </div>

      <dl className="divide-edge mt-2 flex flex-col divide-y">
        {entry.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="text-ink min-w-0 truncate text-sm">
              {l.accountCode} · {l.accountName}
            </dt>
            <dd className="shrink-0 text-right">
              <span className="text-ink text-sm tabular-nums">
                {l.debit > 0 ? baht(l.debit) : "—"}
              </span>
              <span className="text-ink-secondary ml-3 text-sm tabular-nums">
                {l.credit > 0 ? baht(l.credit) : "—"}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {error && (
        <div role="alert" className={`${INLINE_ERROR} mt-2`}>
          {error}
        </div>
      )}
    </li>
  );
}

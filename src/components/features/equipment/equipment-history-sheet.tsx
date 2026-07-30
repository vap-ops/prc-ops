"use client";

// Spec 381 U2 — ประวัติ: one item's timeline, opened from the row's control
// cluster (ย้าย · แก้ไข · ประวัติ).
//
// Fetched ON OPEN, never on page load. /equipment lists up to 64 rows and nobody
// opens 64 timelines; eager loading would be 64 definer-RPC calls for sheets the
// operator may never tap.
//
// Everything that decides WHAT is visible lives in the U1 RPC — the role gate and
// the money omission (rate events are absent, not redacted, for a non-back-office
// caller). This component renders whatever comes back and never second-guesses
// it, so there is no second copy of that rule to drift.
//
// 'use client': sheet open state, the fetch-on-open lifecycle, and the
// loading/error/empty branches are all client state.

import { useState } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_SECONDARY_COMPACT } from "@/lib/ui/classes";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { bangkokDateOf } from "@/lib/dates";
import {
  EQUIPMENT_HISTORY_KIND_LABEL,
  describeHistoryEntry,
  type EquipmentHistoryKind,
} from "@/lib/equipment/history-labels";
import { loadEquipmentHistory, type EquipmentHistoryEntry } from "@/app/equipment/history-actions";

export function EquipmentHistorySheet({ itemId, itemName }: { itemId: string; itemName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<EquipmentHistoryEntry[] | null>(null);

  async function openSheet() {
    setOpen(true);
    setError(null);
    setBusy(true);
    const result = await loadEquipmentHistory(itemId);
    setBusy(false);
    if (!result.ok) {
      // Distinguished from "no history": a refusal that renders as an empty
      // timeline is the honest-copy defect wearing a new hat.
      setEntries(null);
      setError(result.error);
      return;
    }
    setEntries(result.entries);
  }

  return (
    <>
      <button type="button" onClick={() => void openSheet()} className={BUTTON_SECONDARY_COMPACT}>
        ประวัติ
      </button>

      <BottomSheet open={open} title={`ประวัติ — ${itemName}`} onClose={() => setOpen(false)}>
        {busy && <p className="text-ink-secondary mt-2 text-sm">กำลังโหลด…</p>}

        {error && (
          <p role="alert" className={`mt-2 ${INLINE_ERROR}`}>
            {error}
          </p>
        )}

        {!busy && !error && entries?.length === 0 && (
          <p className="text-ink-secondary mt-2 text-sm">
            ยังไม่มีประวัติของอุปกรณ์ชิ้นนี้ — รายการจะขึ้นเมื่อมีการแก้ไข ย้าย หรือยืม/คืน
          </p>
        )}

        {!busy && !error && entries && entries.length > 0 && (
          <ul className="mt-2 flex flex-col gap-3">
            {entries.map((e, i) => {
              const detail = describeHistoryEntry(e);
              return (
                <li
                  key={`${e.occurredAt}-${e.kind}-${i}`}
                  className="border-edge flex flex-col gap-0.5 border-b pb-3 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink text-body font-medium">
                      {EQUIPMENT_HISTORY_KIND_LABEL[e.kind as EquipmentHistoryKind] ?? e.kind}
                    </span>
                    {/* Bangkok calendar date — app dates are never UTC (spec 46 C7). */}
                    <span className="text-ink-muted text-meta shrink-0">
                      {bangkokDateOf(e.occurredAt)}
                    </span>
                  </div>
                  {detail && <span className="text-ink-secondary text-sm">{detail}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </BottomSheet>
    </>
  );
}

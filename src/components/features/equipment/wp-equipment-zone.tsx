"use client";

// Spec 202 U2 — the WP อุปกรณ์ tab: check equipment OUT to this work package and
// back IN. Mirrors the ทีมงาน (labor) tab but simpler (one item per checkout, no
// roster). RATE-FREE: the screen never shows daily_rate_snapshot (admin-only) —
// the field records spans, the check_out_equipment definer snapshots the rate
// server-side. Writes go through the usage-actions; locked (procurement / a
// complete WP) drops every write affordance, leaving read-only history.
//
// 'use client' justification: the check-out form + per-row check-in state.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CARD,
  FIELD_STACKED,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
} from "@/lib/ui/classes";
import { checkOutEquipment, checkInEquipment } from "@/lib/equipment/usage-actions";
import {
  EQUIPMENT_CHECK_OUT_LABEL,
  EQUIPMENT_CHECK_IN_LABEL,
  EQUIPMENT_IN_USE_LABEL,
} from "@/lib/i18n/labels";
import type { EquipmentUsageDisplay } from "@/lib/equipment/usage-rows";

type EquipmentPickItem = { id: string; name: string; assetTag: string | null };

export function WpEquipmentZone({
  workPackageId,
  revalidate,
  items,
  itemNames,
  open,
  history,
  locked,
  defaultDate,
}: {
  workPackageId: string;
  revalidate: string;
  items: EquipmentPickItem[];
  itemNames: Record<string, string>;
  open: EquipmentUsageDisplay[];
  history: EquipmentUsageDisplay[];
  locked: boolean;
  defaultDate: string;
}) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [checkoutDate, setCheckoutDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-row check-in state: which open span is being returned + its date.
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [checkinDate, setCheckinDate] = useState(defaultDate);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const openItemIds = new Set(open.map((r) => r.itemId));
  // An item already checked out can't be checked out again (the RPC blocks it; the
  // picker hides it too).
  const available = items.filter((it) => !openItemIds.has(it.id));

  const labelFor = (id: string) => itemNames[id] ?? "อุปกรณ์";

  async function submitCheckOut() {
    setError(null);
    if (!itemId) {
      setError("เลือกอุปกรณ์ก่อน");
      return;
    }
    setBusy(true);
    const result = await checkOutEquipment({ workPackageId, itemId, checkoutDate, revalidate });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setItemId("");
    router.refresh();
  }

  async function submitCheckIn(logId: string) {
    setCheckInError(null);
    setCheckInBusy(true);
    const result = await checkInEquipment({ logId, checkinDate, revalidate });
    setCheckInBusy(false);
    if (!result.ok) {
      setCheckInError(result.error);
      return;
    }
    setCheckInId(null);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      {!locked ? (
        <div className={CARD}>
          <p className="text-ink text-sm font-semibold">{EQUIPMENT_CHECK_OUT_LABEL}อุปกรณ์</p>
          <label className="text-ink-secondary mt-2 block text-sm">
            วันที่เช็คเอาท์
            <input
              aria-label="วันที่เช็คเอาท์"
              type="date"
              value={checkoutDate}
              onChange={(e) => setCheckoutDate(e.target.value)}
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            อุปกรณ์
            <select
              aria-label="เลือกอุปกรณ์"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className={`${FIELD_STACKED} appearance-none`}
            >
              <option value="">— เลือกอุปกรณ์ —</option>
              {available.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                  {it.assetTag ? ` · ${it.assetTag}` : ""}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
          <button
            type="button"
            disabled={busy || itemId === "" || available.length === 0}
            onClick={() => void submitCheckOut()}
            className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
          >
            {EQUIPMENT_CHECK_OUT_LABEL}
          </button>
        </div>
      ) : null}

      <div className={CARD}>
        <p className="text-ink text-sm font-semibold">{EQUIPMENT_IN_USE_LABEL}</p>
        {open.length > 0 ? (
          <ul className="mt-2 flex flex-col">
            {open.map((r) => (
              <li key={r.id} className="border-edge border-t py-2 first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm">{labelFor(r.itemId)}</p>
                    <p className="text-ink-secondary text-xs">เช็คเอาท์เมื่อ {r.checkedOutOn}</p>
                  </div>
                  {!locked ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCheckInId((v) => (v === r.id ? null : r.id));
                        setCheckinDate(defaultDate);
                        setCheckInError(null);
                      }}
                      className="text-action shrink-0 text-xs font-medium hover:underline"
                    >
                      {EQUIPMENT_CHECK_IN_LABEL}
                    </button>
                  ) : null}
                </div>
                {!locked && checkInId === r.id ? (
                  <div className="border-edge-strong bg-page mt-2 rounded-lg border p-3">
                    <label className="text-ink-secondary block text-sm">
                      วันที่คืน
                      <input
                        aria-label="วันที่คืน"
                        type="date"
                        value={checkinDate}
                        onChange={(e) => setCheckinDate(e.target.value)}
                        className={FIELD_STACKED}
                      />
                    </label>
                    {checkInError ? (
                      <p className="text-danger mt-2 text-sm">{checkInError}</p>
                    ) : null}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={checkInBusy}
                        onClick={() => void submitCheckIn(r.id)}
                        className={BUTTON_PRIMARY_COMPACT}
                      >
                        ยืนยัน
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheckInId(null)}
                        className={BUTTON_SECONDARY_COMPACT}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-secondary mt-2 text-sm">ยังไม่มีอุปกรณ์ที่กำลังใช้งานในงานนี้</p>
        )}
      </div>

      {history.length > 0 ? (
        <div className={CARD}>
          <p className="text-ink text-sm font-semibold">ประวัติ</p>
          <ul className="mt-2 flex flex-col">
            {history.map((r) => (
              <li key={r.id} className="border-edge border-t py-2 first:border-t-0">
                <p className="text-ink truncate text-sm">{labelFor(r.itemId)}</p>
                <p className="text-ink-secondary text-xs">
                  {r.checkedOutOn} – {r.checkedInOn}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

"use client";

// Spec 363 U7 — the เครื่องมือ section at the foot of the WP ของ tab (D6: its
// own entry, never merged into the catalog search). Out-loans render as open
// obligations OLDEST FIRST with the aging clock; ยืมเครื่องมือ and คืน activate
// the spec 202 U2 RPCs through the evidence-carrying actions (spec 370 D4: ≥1
// condition photo BOTH directions — submit is disabled until the upload
// SUCCEEDED, so the requirement cannot leak on this door).
//
// The section itself is the outcome surface: a successful ยืม/คืน closes the
// sheet and the refreshed list visibly gains/loses the row (the silent-success
// lesson). A PARTIAL failure (span recorded, photos didn't land) also refreshes
// — the list must show the new truth even while the error is on screen.
//
// The คืน sheet + photo strip live in return-sheet.tsx, SHARED with the store
// section (368 U4) — one component per fact, two doors that cannot drift.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CARD } from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { PersonPicker, type PersonOption } from "@/components/features/common/person-picker";
import { checkOutEquipment } from "@/lib/equipment/usage-actions";
import {
  EquipmentReturnSheet,
  PhotoCaptureStrip,
  agingLabel,
  usePhotoStrip,
  type ReturnableLoan,
} from "@/components/features/equipment/return-sheet";
import type { BorrowableItem } from "@/lib/equipment/wp-loans";

export interface WpLoanDisplayRow {
  logId: string;
  itemId: string;
  itemName: string;
  holderName: string;
  checkedOutOn: string;
  days: number;
}

export function WpEquipmentSection({
  wpId,
  loans,
  available,
  roster,
  canAct,
  wpComplete,
  revalidate,
}: {
  wpId: string;
  loans: readonly WpLoanDisplayRow[];
  available: readonly BorrowableItem[];
  roster: readonly PersonOption[];
  canAct: boolean;
  wpComplete: boolean;
  revalidate: string;
}) {
  const router = useRouter();
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [returnLoan, setReturnLoan] = useState<ReturnableLoan | null>(null);
  const [pickedItem, setPickedItem] = useState<BorrowableItem | null>(null);
  const [borrowerId, setBorrowerId] = useState("");
  const [filter, setFilter] = useState("");
  const [borrowError, setBorrowError] = useState<string | null>(null);
  // ref = the same-tick double-tap guard (state alone lags a frame — the
  // muster cooldown lesson); state = what the button renders from.
  const submitRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const borrowStrip = usePhotoStrip();

  const closeBorrow = () => {
    setBorrowOpen(false);
    setPickedItem(null);
    setBorrowerId("");
    setFilter("");
    setBorrowError(null);
    borrowStrip.reset();
  };
  // เปลี่ยน swaps the ITEM — the evidence photographed for the previous item
  // goes with it (fresh-eyes 🔴3: keeping it would let a mis-tap borrow ship
  // another tool's photos as its condition record).
  const switchItem = () => {
    setPickedItem(null);
    setBorrowError(null);
    borrowStrip.reset();
  };

  const submitBorrow = async () => {
    if (!pickedItem || borrowStrip.photos.length === 0 || submitRef.current) return;
    submitRef.current = true;
    setSubmitting(true);
    setBorrowError(null);
    const res = await checkOutEquipment({
      workPackageId: wpId,
      itemId: pickedItem.id,
      checkoutDate: bangkokTodayIso(),
      revalidate,
      via: "wp_tab",
      photoPaths: borrowStrip.photos.map((p) => p.path),
      ...(borrowerId ? { borrowerWorkerId: borrowerId } : {}),
    });
    submitRef.current = false;
    setSubmitting(false);
    if (res.ok) {
      closeBorrow();
    } else {
      setBorrowError(res.error);
    }
    // Refresh either way: a PARTIAL failure (span opened, photos didn't land)
    // must update the list even while the error stays on screen.
    router.refresh();
  };

  const filtered = filter
    ? available.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
    : available;
  const showBorrowDoor = canAct && !wpComplete;

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink text-body font-semibold">เครื่องมือ</p>
        {showBorrowDoor ? (
          <button
            type="button"
            onClick={() => setBorrowOpen(true)}
            className="border-edge-strong rounded-control text-ink min-h-11 border px-3 text-sm"
          >
            ยืมเครื่องมือ
          </button>
        ) : null}
      </div>

      {loans.length === 0 ? (
        <p className="text-ink-secondary text-meta mt-2">ไม่มีเครื่องมือถูกยืมมาที่งานนี้</p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {loans.map((l) => (
            <li
              key={l.logId}
              className="border-edge flex min-h-11 items-center gap-3 border-b py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-ink text-sm">{l.itemName}</p>
                <p className="text-ink-secondary text-meta">
                  {agingLabel(l.days)} · {l.holderName}
                </p>
              </div>
              {canAct ? (
                <button
                  type="button"
                  onClick={() => setReturnLoan(l)}
                  className="border-edge-strong rounded-control text-ink min-h-11 border px-3 text-sm"
                >
                  คืน
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <BottomSheet open={borrowOpen} title="ยืมเครื่องมือ" onClose={closeBorrow}>
        <div className="flex flex-col gap-3">
          {available.length === 0 ? (
            <p className="text-ink-secondary text-body">ไม่มีอุปกรณ์ว่างในโครงการนี้</p>
          ) : pickedItem === null ? (
            <>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="ค้นหาเครื่องมือ"
                aria-label="ค้นหาเครื่องมือ"
                className="border-edge-strong rounded-control h-11 w-full border px-3"
              />
              {filtered.length === 0 ? (
                <p className="text-ink-secondary text-meta">ไม่พบเครื่องมือชื่อนี้</p>
              ) : (
                <ul className="flex max-h-72 flex-col overflow-y-auto">
                  {filtered.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => setPickedItem(i)}
                        className="border-edge text-ink flex min-h-11 w-full items-center border-b px-1 text-left text-sm last:border-b-0"
                      >
                        {i.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-ink text-sm font-medium">{pickedItem.name}</p>
                <button type="button" onClick={switchItem} className="text-action min-h-11 text-sm">
                  เปลี่ยน
                </button>
              </div>
              <PersonPicker
                label="ผู้ยืม (ไม่บังคับ)"
                people={roster}
                selectedId={borrowerId}
                onChange={setBorrowerId}
                restingLabel="ไม่ระบุ"
                clearLabel="ไม่ระบุผู้ยืม"
                searchPlaceholder="ค้นหาชื่อ"
                sheetTitle="เลือกผู้ยืม"
                emptyRosterLabel="ยังไม่มีรายชื่อทีมงาน"
              />
              <PhotoCaptureStrip label="รูปสภาพก่อนยืม" strip={borrowStrip} />
              {borrowError ? (
                <p aria-live="polite" className="text-danger text-meta">
                  {borrowError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={submitBorrow}
                disabled={borrowStrip.photos.length === 0 || borrowStrip.busy || submitting}
                className="bg-action text-on-fill rounded-control min-h-11 w-full text-sm font-semibold disabled:opacity-50"
              >
                ยืมออก
              </button>
            </>
          )}
        </div>
      </BottomSheet>

      <EquipmentReturnSheet
        loan={returnLoan}
        via="wp_tab"
        revalidate={revalidate}
        onClose={() => setReturnLoan(null)}
      />
    </div>
  );
}

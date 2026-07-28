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
// State discipline (fresh-eyes 🔴2/🔴3/🟡7): each sheet owns its OWN error;
// the photo strips are epoch-guarded so an upload resolving after close/เปลี่ยน
// can never re-arm a submit with another item's evidence; submits are
// ref-guarded against same-frame double-taps (the muster cooldown lesson).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CARD } from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { PersonPicker, type PersonOption } from "@/components/features/common/person-picker";
import {
  checkInEquipment,
  checkOutEquipment,
  fetchLoanPhotoUrls,
} from "@/lib/equipment/usage-actions";
import { uploadConditionPhotos } from "@/lib/equipment/photo-upload";
import type { BorrowableItem } from "@/lib/equipment/wp-loans";

export interface WpLoanDisplayRow {
  logId: string;
  itemId: string;
  itemName: string;
  holderName: string;
  checkedOutOn: string;
  days: number;
}

function agingLabel(days: number): string {
  return days <= 0 ? "ยืมวันนี้" : `ยืม ${days} วัน`;
}

interface StripPhoto {
  path: string;
  previewUrl: string;
}

// One capture strip used by both sheets. Uploads immediately on pick — the
// submit gates on UPLOADED paths, not picked files, so a dead network surfaces
// here, not as a phantom-complete borrow. Epoch guard: reset() bumps the epoch,
// and a resolution from an older epoch is DROPPED — closing the sheet or
// switching items mid-upload can never leave stale evidence armed.
function usePhotoStrip() {
  const [photos, setPhotos] = useState<readonly StripPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epochRef = useRef(0);
  const pick = async (files: File[]) => {
    const epoch = epochRef.current;
    setBusy(true);
    setError(null);
    const previews = files.map((f) => URL.createObjectURL(f));
    const res = await uploadConditionPhotos(files);
    if (epochRef.current !== epoch) {
      previews.forEach((u) => URL.revokeObjectURL(u));
      return;
    }
    setBusy(false);
    if (res.ok) {
      setPhotos((prev) => [
        ...prev,
        ...res.paths.map((path, i) => ({ path, previewUrl: previews[i] ?? "" })),
      ]);
    } else {
      previews.forEach((u) => URL.revokeObjectURL(u));
      setError(res.error);
    }
  };
  const reset = () => {
    epochRef.current += 1;
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    setBusy(false);
    setError(null);
  };
  return { photos, busy, error, pick, reset };
}

function PhotoCaptureStrip({
  label,
  strip,
}: {
  label: string;
  strip: ReturnType<typeof usePhotoStrip>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`strip-${label}`} className="text-ink-secondary text-meta">
        {label} (อย่างน้อย 1 รูป)
      </label>
      <input
        id={`strip-${label}`}
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void strip.pick(files);
          e.target.value = "";
        }}
      />
      <div className="flex [touch-action:pan-x_pinch-zoom] items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={strip.busy}
          aria-busy={strip.busy}
          className="border-edge-strong rounded-control text-ink flex h-16 w-16 shrink-0 items-center justify-center border border-dashed text-2xl"
          aria-label={`เปิดกล้อง — ${label}`}
        >
          {strip.busy ? "…" : "+"}
        </button>
        {strip.photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.path}
            src={p.previewUrl}
            alt={`${label} ${i + 1}`}
            className="h-16 w-16 shrink-0 rounded object-cover"
          />
        ))}
      </div>
      {strip.error ? (
        <p aria-live="polite" className="text-danger text-meta">
          {strip.error}
        </p>
      ) : null}
    </div>
  );
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
  const [returnLog, setReturnLog] = useState<WpLoanDisplayRow | null>(null);
  const [pickedItem, setPickedItem] = useState<BorrowableItem | null>(null);
  const [borrowerId, setBorrowerId] = useState("");
  const [filter, setFilter] = useState("");
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  // Borrow-time photos for the compare strip, minted ON OPEN — page-render
  // signed URLs are dead (120s TTL) by the time a sheet opens (fresh-eyes 🟡6).
  const [beforeUrls, setBeforeUrls] = useState<readonly string[] | null>(null);
  // ref = the same-tick double-tap guard (state alone lags a frame — the
  // muster cooldown lesson); state = what the buttons render from.
  const submitRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const borrowStrip = usePhotoStrip();
  const returnStrip = usePhotoStrip();

  const closeBorrow = () => {
    setBorrowOpen(false);
    setPickedItem(null);
    setBorrowerId("");
    setFilter("");
    setBorrowError(null);
    borrowStrip.reset();
  };
  const closeReturn = () => {
    setReturnLog(null);
    setReturnError(null);
    setBeforeUrls(null);
    returnStrip.reset();
  };
  // เปลี่ยน swaps the ITEM — the evidence photographed for the previous item
  // goes with it (fresh-eyes 🔴3: keeping it would let a mis-tap borrow ship
  // another tool's photos as its condition record).
  const switchItem = () => {
    setPickedItem(null);
    setBorrowError(null);
    borrowStrip.reset();
  };
  const openReturn = (l: WpLoanDisplayRow) => {
    setReturnLog(l);
    setBeforeUrls(null);
    void fetchLoanPhotoUrls(l.logId).then((r) => {
      setBeforeUrls(r.ok ? r.urls : []);
    });
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

  const submitReturn = async () => {
    if (!returnLog || returnStrip.photos.length === 0 || submitRef.current) return;
    submitRef.current = true;
    setSubmitting(true);
    setReturnError(null);
    const res = await checkInEquipment({
      logId: returnLog.logId,
      checkinDate: bangkokTodayIso(),
      revalidate,
      via: "wp_tab",
      photoPaths: returnStrip.photos.map((p) => p.path),
    });
    submitRef.current = false;
    setSubmitting(false);
    if (res.ok) {
      closeReturn();
    } else {
      setReturnError(res.error);
    }
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
                  onClick={() => openReturn(l)}
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

      <BottomSheet open={returnLog !== null} title="คืนเครื่องมือ" onClose={closeReturn}>
        {returnLog ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-ink text-sm font-medium">{returnLog.itemName}</p>
              <p className="text-ink-secondary text-meta">
                {agingLabel(returnLog.days)} · {returnLog.holderName}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-ink-secondary text-meta">รูปตอนยืม (เทียบสภาพ)</p>
              {beforeUrls === null ? (
                <p className="text-ink-muted text-meta">กำลังโหลดรูป…</p>
              ) : beforeUrls.length === 0 ? (
                <p className="text-ink-muted text-meta">ไม่มีรูปตอนยืม</p>
              ) : (
                <div className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto">
                  {beforeUrls.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={u}
                      src={u}
                      alt={`รูปตอนยืม ${i + 1}`}
                      className="h-16 w-16 shrink-0 rounded object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
            <PhotoCaptureStrip label="รูปสภาพตอนคืน" strip={returnStrip} />
            {returnError ? (
              <p aria-live="polite" className="text-danger text-meta">
                {returnError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={submitReturn}
              disabled={returnStrip.photos.length === 0 || returnStrip.busy || submitting}
              className="bg-action text-on-fill rounded-control min-h-11 w-full text-sm font-semibold disabled:opacity-50"
            >
              บันทึกการคืน
            </button>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}

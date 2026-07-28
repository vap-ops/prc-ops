"use client";

// Spec 363 U7 — the เครื่องมือ section at the foot of the WP ของ tab (D6: its
// own entry, never merged into the catalog search). Out-loans render as open
// obligations with the aging clock; ยืมเครื่องมือ and คืน activate the spec 202
// U2 RPCs through the evidence-carrying actions (spec 370 D4: ≥1 condition
// photo BOTH directions — the submit is disabled until the upload succeeded, so
// the requirement cannot leak on this door).
//
// The section itself is the outcome surface: a successful ยืม/คืน closes the
// sheet and the refreshed list visibly gains/loses the row — unlike a hub
// behind a full-screen sheet, the state change happens exactly where the user
// is looking (the silent-success lesson).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CARD } from "@/lib/ui/classes";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { PersonPicker, type PersonOption } from "@/components/features/common/person-picker";
import { checkInEquipment, checkOutEquipment } from "@/lib/equipment/usage-actions";
import { uploadConditionPhotos } from "@/lib/equipment/photo-upload";
import type { BorrowableItem } from "@/lib/equipment/wp-loans";

export interface WpLoanDisplayRow {
  logId: string;
  itemId: string;
  itemName: string;
  holderName: string;
  checkedOutOn: string;
  days: number;
  /** Signed URLs for the borrow-time photos, for the คืน compare strip. */
  outPhotoUrls: readonly string[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function agingLabel(days: number): string {
  return days <= 0 ? "ยืมวันนี้" : `ยืม ${days} วัน`;
}

// One capture strip used by both sheets. Uploads immediately on pick — the
// submit gates on UPLOADED paths, not on picked files, so a dead network shows
// up here and not as a phantom-complete borrow.
function PhotoCaptureStrip({
  label,
  paths,
  busy,
  error,
  onPick,
}: {
  label: string;
  paths: readonly string[];
  busy: boolean;
  error: string | null;
  onPick: (files: File[]) => void;
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
          if (files.length > 0) onPick(files);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="border-edge-strong rounded-control text-ink flex h-16 w-16 items-center justify-center border border-dashed text-2xl"
          aria-label={`ถ่ายรูป — ${label}`}
        >
          {busy ? "…" : "+"}
        </button>
        {paths.length > 0 ? (
          <span className="text-ink-secondary text-meta">ถ่ายแล้ว {paths.length} รูป ✓</span>
        ) : null}
      </div>
      {error ? <p className="text-danger text-meta">{error}</p> : null}
    </div>
  );
}

function usePhotoStrip() {
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (files: File[]) => {
    setBusy(true);
    setError(null);
    const res = await uploadConditionPhotos(files);
    setBusy(false);
    if (res.ok) setPaths((prev) => [...prev, ...res.paths]);
    else setError(res.error);
  };
  const reset = () => {
    setPaths([]);
    setError(null);
  };
  return { paths, busy, error, pick, reset };
}

export function WpEquipmentSection({
  wpId,
  loans,
  available,
  roster,
  canAct,
  revalidate,
}: {
  wpId: string;
  loans: readonly WpLoanDisplayRow[];
  available: readonly BorrowableItem[];
  roster: readonly PersonOption[];
  canAct: boolean;
  revalidate: string;
}) {
  const router = useRouter();
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [returnLog, setReturnLog] = useState<WpLoanDisplayRow | null>(null);
  const [pickedItem, setPickedItem] = useState<BorrowableItem | null>(null);
  const [borrowerId, setBorrowerId] = useState("");
  const [filter, setFilter] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const borrowStrip = usePhotoStrip();
  const returnStrip = usePhotoStrip();

  const closeBorrow = () => {
    setBorrowOpen(false);
    setPickedItem(null);
    setBorrowerId("");
    setFilter("");
    setSubmitError(null);
    borrowStrip.reset();
  };
  const closeReturn = () => {
    setReturnLog(null);
    setSubmitError(null);
    returnStrip.reset();
  };

  const submitBorrow = async () => {
    if (!pickedItem || borrowStrip.paths.length === 0 || submitBusy) return;
    setSubmitBusy(true);
    setSubmitError(null);
    const res = await checkOutEquipment({
      workPackageId: wpId,
      itemId: pickedItem.id,
      checkoutDate: todayIso(),
      revalidate,
      via: "wp_tab",
      photoPaths: borrowStrip.paths,
      ...(borrowerId ? { borrowerWorkerId: borrowerId } : {}),
    });
    setSubmitBusy(false);
    if (res.ok) {
      closeBorrow();
      router.refresh();
    } else {
      setSubmitError(res.error);
    }
  };

  const submitReturn = async () => {
    if (!returnLog || returnStrip.paths.length === 0 || submitBusy) return;
    setSubmitBusy(true);
    setSubmitError(null);
    const res = await checkInEquipment({
      logId: returnLog.logId,
      checkinDate: todayIso(),
      revalidate,
      via: "wp_tab",
      photoPaths: returnStrip.paths,
    });
    setSubmitBusy(false);
    if (res.ok) {
      closeReturn();
      router.refresh();
    } else {
      setSubmitError(res.error);
    }
  };

  const filtered = filter
    ? available.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
    : available;

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink text-body font-semibold">เครื่องมือ</p>
        {canAct ? (
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
                  onClick={() => setReturnLog(l)}
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
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-ink text-sm font-medium">{pickedItem.name}</p>
                <button
                  type="button"
                  onClick={() => setPickedItem(null)}
                  className="text-action text-sm"
                >
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
              <PhotoCaptureStrip
                label="รูปสภาพก่อนยืม"
                paths={borrowStrip.paths}
                busy={borrowStrip.busy}
                error={borrowStrip.error}
                onPick={borrowStrip.pick}
              />
              {submitError ? <p className="text-danger text-meta">{submitError}</p> : null}
              <button
                type="button"
                onClick={submitBorrow}
                disabled={borrowStrip.paths.length === 0 || submitBusy}
                className="bg-action text-on-fill rounded-control min-h-11 w-full text-sm font-semibold disabled:opacity-50"
              >
                ยืมออก
              </button>
            </>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={returnLog !== null} title="คืนเข้าคลัง" onClose={closeReturn}>
        {returnLog ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-ink text-sm font-medium">{returnLog.itemName}</p>
              <p className="text-ink-secondary text-meta">
                {agingLabel(returnLog.days)} · {returnLog.holderName}
              </p>
            </div>
            {returnLog.outPhotoUrls.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-ink-secondary text-meta">รูปตอนยืม (เทียบสภาพ)</p>
                <div className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto">
                  {returnLog.outPhotoUrls.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={u}
                      src={u}
                      alt={`รูปตอนยืม ${i + 1}`}
                      className="h-16 w-16 rounded object-cover"
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <PhotoCaptureStrip
              label="รูปสภาพตอนคืน"
              paths={returnStrip.paths}
              busy={returnStrip.busy}
              error={returnStrip.error}
              onPick={returnStrip.pick}
            />
            {submitError ? <p className="text-danger text-meta">{submitError}</p> : null}
            <button
              type="button"
              onClick={submitReturn}
              disabled={returnStrip.paths.length === 0 || submitBusy}
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

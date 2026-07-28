"use client";

// Spec 370 U2 — the scan screen: one camera, one search box, and the state
// machine that decides which sheet a resolved item opens (D1: scan is the
// primary door BOTH directions at the store).
//
//   camera/NFC/deep-link/search → parseScanText/resolveScanState →
//     in_store → ยืม sheet (WP picker over the item's project's leaf WPs +
//                 required photos, via='scan'; borrower deliberately omitted
//                 v1 — the WP-tab/store doors carry it)
//     out      → the SHARED return sheet (via='scan')
//     bulk     → an explanatory refusal (D5), never a silent nothing
//     not_found→ "not an equipment sticker"
//
// The OUTCOME states itself in place (the silent-success lesson): after a
// successful ยืม/คืน the screen shows what happened — item, direction, WP,
// photo count — and re-arms for the next scan. The camera is MusterCamera
// reused verbatim: it emits raw decoded text; parsing lives here.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CARD } from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import { MusterCamera } from "@/components/features/muster/muster-camera";
import { hasScannerSupport } from "@/lib/muster/scanner-support";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  EquipmentReturnSheet,
  PhotoCaptureStrip,
  usePhotoStrip,
  type ReturnableLoan,
} from "@/components/features/equipment/return-sheet";
import { checkOutEquipment } from "@/lib/equipment/usage-actions";
import {
  parseScanText,
  resolveScanState,
  searchScanItems,
  type ScanItem,
  type ScanOpenLoan,
  type ScanState,
} from "@/lib/equipment/scan-resolve";
import { loanDays } from "@/lib/equipment/wp-loans";

export interface ScanLeafWp {
  id: string;
  projectId: string;
  code: string;
  name: string;
}

interface Outcome {
  text: string;
}

export function EquipmentScanClient({
  items,
  openLoans,
  itemProjects,
  leafWps,
  initialItemId,
  revalidate,
}: {
  items: readonly ScanItem[];
  openLoans: readonly ScanOpenLoan[];
  itemProjects: Readonly<Record<string, string>>;
  leafWps: readonly ScanLeafWp[];
  initialItemId: string | null;
  revalidate: string;
}) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState<ScanState | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [wpPick, setWpPick] = useState<ScanLeafWp | null>(null);
  const [wpFilter, setWpFilter] = useState("");
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const submitRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const borrowStrip = usePhotoStrip();
  const canScan = hasScannerSupport();

  const resolve = (itemId: string) => {
    setOutcome(null);
    setScanning(false);
    setState(resolveScanState(itemId, items, openLoans));
  };

  // Deep link (?item= from a QR/NFC sticker) resolves on arrival — the camera
  // never opens for a tag tap.
  const initialRef = useRef(initialItemId);
  useEffect(() => {
    if (initialRef.current) resolve(initialRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDecoded = (raw: string) => {
    const id = parseScanText(raw);
    if (id) resolve(id);
  };

  const closeBorrow = () => {
    setState(null);
    setWpPick(null);
    setWpFilter("");
    setBorrowError(null);
    borrowStrip.reset();
  };

  const submitBorrow = async () => {
    if (state?.kind !== "in_store" || !wpPick || borrowStrip.photos.length === 0) return;
    if (submitRef.current) return;
    submitRef.current = true;
    setSubmitting(true);
    setBorrowError(null);
    const res = await checkOutEquipment({
      workPackageId: wpPick.id,
      itemId: state.item.id,
      checkoutDate: bangkokTodayIso(),
      revalidate,
      via: "scan",
      photoPaths: borrowStrip.photos.map((p) => p.path),
    });
    submitRef.current = false;
    setSubmitting(false);
    if (res.ok) {
      setOutcome({
        text: `ยืมแล้ว — ${state.item.name}${state.item.assetTag ? ` (${state.item.assetTag})` : ""} → ${wpPick.code} · รูป ${borrowStrip.photos.length} รูป`,
      });
      closeBorrow();
    } else {
      setBorrowError(res.error);
    }
    router.refresh();
  };

  const returnLoan: ReturnableLoan | null =
    state?.kind === "out"
      ? {
          logId: state.loan.logId,
          itemName: state.item.name,
          holderName: state.loan.holderName,
          days: loanDays(state.loan.checkedOutOn, bangkokTodayIso()),
        }
      : null;

  const hits = q ? searchScanItems(items, q) : [];
  const itemProject = state?.kind === "in_store" ? (itemProjects[state.item.id] ?? null) : null;
  const projectWps = leafWps.filter((w) => w.projectId === itemProject);
  const wpHits = wpFilter
    ? projectWps.filter(
        (w) => w.code.toLowerCase().includes(wpFilter.toLowerCase()) || w.name.includes(wpFilter),
      )
    : projectWps;

  return (
    <div className="flex flex-col gap-4">
      {outcome ? (
        <div className={CARD}>
          <p aria-live="polite" className="text-ink text-body font-semibold">
            ✓ {outcome.text}
          </p>
        </div>
      ) : null}

      <div className={CARD}>
        <p className="text-ink text-body font-semibold">สแกนอุปกรณ์</p>
        <p className="text-ink-secondary text-meta mt-1">
          สแกน QR บนสติกเกอร์ หรือแตะแท็ก NFC — เปิดหน้านี้แล้วเลือกยืม/คืนได้เลย
        </p>
        {canScan ? (
          scanning ? (
            <div className="mt-3">
              <MusterCamera onDetected={onDecoded} />
              <button
                type="button"
                onClick={() => setScanning(false)}
                className="border-edge-strong rounded-control text-ink mt-2 min-h-11 w-full border text-sm"
              >
                ปิดกล้อง
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="bg-action text-on-fill rounded-control mt-3 min-h-11 w-full text-sm font-semibold"
            >
              เปิดกล้องสแกน
            </button>
          )
        ) : (
          <p className="text-ink-muted text-meta mt-2">
            อุปกรณ์นี้ไม่รองรับกล้อง — ใช้ค้นหาด้านล่าง
          </p>
        )}

        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="scan-search" className="text-ink-secondary text-meta">
            สติกเกอร์เสียหาย / ไม่มี — ค้นหาด้วยชื่อ หรือ S/N
          </label>
          <input
            id="scan-search"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ชื่อเครื่องมือ / S/N / รหัส"
            className="border-edge-strong rounded-control h-11 w-full border px-3"
          />
          {q ? (
            hits.length === 0 ? (
              <p className="text-ink-secondary text-meta mt-1">ไม่พบเครื่องมือชื่อนี้</p>
            ) : (
              <ul className="mt-1 flex max-h-72 flex-col overflow-y-auto">
                {hits.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => resolve(i.id)}
                      className="border-edge text-ink flex min-h-11 w-full flex-col items-start justify-center border-b px-1 text-left text-sm last:border-b-0"
                    >
                      <span>{i.name}</span>
                      <span className="text-ink-secondary text-meta">
                        {[i.serialNo, i.assetTag].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </div>

      {state?.kind === "not_found" ? (
        <div className={CARD}>
          <p aria-live="polite" className="text-ink text-body">
            ไม่ใช่สติกเกอร์อุปกรณ์ของระบบ — ลองค้นหาด้วยชื่อแทน
          </p>
        </div>
      ) : null}

      {state?.kind === "bulk" ? (
        <div className={CARD}>
          <p aria-live="polite" className="text-ink text-body">
            {state.item.name} เป็นของแบบนับจำนวน — ยังยืมรายชิ้นไม่ได้ ย้ายได้ที่หน้าอุปกรณ์
          </p>
        </div>
      ) : null}

      <BottomSheet open={state?.kind === "in_store"} title="ยืมออกจากคลัง" onClose={closeBorrow}>
        {state?.kind === "in_store" ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-ink text-sm font-medium">{state.item.name}</p>
              <p className="text-ink-secondary text-meta">
                {[state.item.serialNo, state.item.assetTag].filter(Boolean).join(" · ") ||
                  "อยู่ในคลัง"}
              </p>
            </div>
            {wpPick === null ? (
              <>
                <label htmlFor="scan-wp" className="text-ink-secondary text-meta">
                  ยืมไปงานไหน
                </label>
                <input
                  id="scan-wp"
                  type="text"
                  value={wpFilter}
                  onChange={(e) => setWpFilter(e.target.value)}
                  placeholder="ค้นหางาน (เช่น W05)"
                  className="border-edge-strong rounded-control h-11 w-full border px-3"
                />
                {projectWps.length === 0 ? (
                  <p className="text-ink-secondary text-meta">
                    ไม่พบงานย่อยของโครงการนี้ — ยืมผ่านหน้างานแทน
                  </p>
                ) : (
                  <ul className="flex max-h-60 flex-col overflow-y-auto">
                    {wpHits.map((w) => (
                      <li key={w.id}>
                        <button
                          type="button"
                          onClick={() => setWpPick(w)}
                          className="border-edge text-ink flex min-h-11 w-full items-center gap-2 border-b px-1 text-left text-sm last:border-b-0"
                        >
                          <span className="text-ink-secondary font-mono text-xs">{w.code}</span>
                          <span className="min-w-0 flex-1 truncate">{w.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-ink text-sm">
                    → <span className="font-mono text-xs">{wpPick.code}</span> {wpPick.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => setWpPick(null)}
                    className="text-action min-h-11 text-sm"
                  >
                    เปลี่ยน
                  </button>
                </div>
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
        ) : null}
      </BottomSheet>

      <EquipmentReturnSheet
        loan={returnLoan}
        via="scan"
        revalidate={revalidate}
        onClose={() => setState(null)}
      />
    </div>
  );
}

"use client";

// Spec 144 U2 — "report defect" on a complete WP. 'use client' justified:
// sheet open state, submit pending, inline error, router.refresh after the WP
// reopens to rework. The reportDefect action (+ the SECURITY DEFINER
// reopen_work_package_for_defect RPC) carry the role/membership/complete-only
// gates. Shown by the page only when status='complete'.
//
// Spec 248 U2 — defect photos. Planners (canAttachPhotos = PM/PD/super) attach
// photos of the defect; bytes upload on selection (browser-direct), metadata
// rows land ONLY after the reopen RPC succeeds so they stamp the fresh round.
// Filing is ONLINE-ONLY (offline replay could pollute a closed round): the
// submit is blocked while offline and while photo bytes are in flight. A
// post-reopen insert failure keeps the sheet open with per-photo retry — the
// defect is already filed, so the RPC is never re-fired.

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { REPORT_DEFECT_LABEL, REWORK_SOURCE_LABEL } from "@/lib/i18n/labels";
import type { ReworkSource } from "@/lib/db/enums";
import { reportDefect } from "./actions";
import { useDefectPhotos } from "./use-defect-photos";

const LABEL = "text-sm font-medium text-ink";
const DEFECT_REASON_MAX = 1000;
// Spec 217: the two rework sources, in form order (internal default first).
const SOURCES: ReadonlyArray<ReworkSource> = ["internal", "client"];

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function ReportDefectControl({
  projectId,
  workPackageId,
  canAttachPhotos = false,
  initialOpen = false,
}: {
  projectId: string;
  workPackageId: string;
  /** Spec 248: photo attach is for the filing roles (PM/PD/super) — the page
   *  passes isPlanner. SA keeps text-only filing (the reopen RPC admits SA). */
  canAttachPhotos?: boolean;
  /** Spec 337 U5: arrived from the list's เสร็จแล้ว door (?defect=1) — the sheet
   *  opens on mount so the deep link costs one tap, not two. The page only
   *  renders this control on a complete WP for a non-read-only viewer, so the
   *  param can never open a sheet the viewer wasn't already entitled to. */
  initialOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [reason, setReason] = useState("");
  const [source, setSource] = useState<ReworkSource>("internal");
  const [error, setError] = useState<string | null>(null);
  // Spec 248: set once the reopen RPC succeeded — photo-attach retries must
  // never re-fire the RPC.
  const [reopened, setReopened] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const online = useOnline();
  const { photos, anyInFlight, fileInputRef, handleFiles, attachAll, retry, remove } =
    useDefectPhotos({ projectId, workPackageId });

  const canSubmit = reason.trim() !== "" && !submitting && online && !anyInFlight;

  function finishAndClose() {
    setReason("");
    setSource("internal");
    setReopened(false);
    setOpen(false);
    router.refresh();
  }

  async function attachPhotosThenClose() {
    const failed = await attachAll();
    if (failed > 0) {
      setError(`แนบรูปไม่สำเร็จ ${failed} รูป — แตะที่รูปเพื่อลองใหม่ (เปิดงานใหม่แล้ว)`);
      return;
    }
    finishAndClose();
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      if (reopened) {
        // The defect is already filed — only the photo attach is pending.
        await attachPhotosThenClose();
        return;
      }
      const result = await reportDefect({ projectId, workPackageId, reason, source });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReopened(true);
      await attachPhotosThenClose();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
        {REPORT_DEFECT_LABEL}
      </button>

      <BottomSheet open={open} title={REPORT_DEFECT_LABEL} onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-ink-secondary text-sm">
            งานนี้เสร็จแล้ว การรายงานข้อบกพร่องจะเปิดงานกลับเป็น “งานแก้ไข” เพื่อแก้ไขและส่งตรวจใหม่
          </p>
          {/* Spec 217: who called this rework — ตรวจภายใน vs ลูกค้าแจ้ง. */}
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>ที่มาของข้อบกพร่อง</span>
            <div className="grid grid-cols-2 gap-2">
              {SOURCES.map((s) => {
                const selected = source === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSource(s)}
                    disabled={submitting || reopened}
                    className={`rounded-control focus-visible:ring-action border px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 ${
                      selected
                        ? "border-attn bg-attn-soft text-attn-ink ring-attn/25 ring-2"
                        : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
                    }`}
                  >
                    {REWORK_SOURCE_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="defect-reason" className={LABEL}>
              รายละเอียดข้อบกพร่อง
            </label>
            <textarea
              id="defect-reason"
              value={reason}
              rows={4}
              maxLength={DEFECT_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting || reopened}
              className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
              placeholder="เช่น รอยร้าวที่ผนังด้านทิศเหนือ ต้องฉาบใหม่"
            />
          </div>

          {/* Spec 248: defect photos — each will need an after-fix photo from
              the same angle, so shots should frame the defect clearly. */}
          {canAttachPhotos ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="defect-photos" className={LABEL}>
                แนบรูปข้อบกพร่อง
              </label>
              <p className="text-ink-secondary text-xs">
                ทุกรูปที่แนบ ทีมหน้างานต้องถ่ายรูปหลังแก้ไขจากมุมเดิมก่อนส่งตรวจ
              </p>
              <input
                ref={fileInputRef}
                id="defect-photos"
                type="file"
                accept="image/*"
                multiple
                disabled={submitting}
                onChange={(e) => void handleFiles(e.target.files)}
                className="text-ink-secondary text-sm"
              />
              {photos.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {photos.map((p) => (
                    <li key={p.id} className="flex flex-col items-center gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                      <img
                        src={p.previewUrl}
                        alt={p.fileName}
                        className={`border-edge size-16 rounded border object-cover ${
                          p.status === "uploading" ? "opacity-50" : ""
                        }`}
                      />
                      {p.status === "upload-error" || p.status === "insert-error" ? (
                        <button
                          type="button"
                          onClick={() => void retry(p.id)}
                          className="text-danger text-xs font-semibold underline underline-offset-2"
                        >
                          ลองใหม่
                        </button>
                      ) : p.status === "saved" ? (
                        <span className="text-done-ink text-xs">แนบแล้ว</span>
                      ) : (
                        // Un-saved photos stay removable even post-reopen — a
                        // newly-added unwanted shot must never be trapped.
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          disabled={p.status === "uploading"}
                          className="text-ink-secondary text-xs underline underline-offset-2"
                        >
                          ลบ
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {!online ? (
            <p role="status" className="text-attn-ink text-sm">
              ออฟไลน์อยู่ — ต้องเชื่อมต่ออินเทอร์เน็ตก่อนเปิดงานใหม่
            </p>
          ) : null}

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังเปิดงานใหม่…" : reopened ? "แนบรูปอีกครั้ง" : "เปิดงานใหม่"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}

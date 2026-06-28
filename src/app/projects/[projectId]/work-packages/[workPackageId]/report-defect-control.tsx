"use client";

// Spec 144 U2 — "report defect" on a complete WP. 'use client' justified:
// sheet open state, submit pending, inline error, router.refresh after the WP
// reopens to rework. The reportDefect action (+ the SECURITY DEFINER
// reopen_work_package_for_defect RPC) carry the role/membership/complete-only
// gates. Shown by the page only when status='complete'.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { REWORK_SOURCE_LABEL } from "@/lib/i18n/labels";
import type { ReworkSource } from "@/lib/db/enums";
import { reportDefect } from "./actions";

const LABEL = "text-sm font-medium text-ink";
const DEFECT_REASON_MAX = 1000;
// Spec 217: the two rework sources, in form order (internal default first).
const SOURCES: ReadonlyArray<ReworkSource> = ["internal", "client"];

export function ReportDefectControl({
  projectId,
  workPackageId,
}: {
  projectId: string;
  workPackageId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [source, setSource] = useState<ReworkSource>("internal");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit = reason.trim() !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await reportDefect({ projectId, workPackageId, reason, source });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReason("");
      setSource("internal");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
        รายงานข้อบกพร่อง
      </button>

      <BottomSheet open={open} title="รายงานข้อบกพร่อง" onClose={() => setOpen(false)}>
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
                    disabled={submitting}
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
              disabled={submitting}
              className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
              placeholder="เช่น รอยร้าวที่ผนังด้านทิศเหนือ ต้องฉาบใหม่"
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังเปิดงานใหม่…" : "เปิดงานใหม่"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}

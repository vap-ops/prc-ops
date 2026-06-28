"use client";

// FB2 (b9e942f0) — "ส่งงานเข้าตรวจ": the SA explicitly submits a finished WP for
// approval. Replaces the old auto-flip that fired on the first "after" photo
// (which sent partly-done WPs to review early). 'use client' justified: sheet
// open state, submit pending, inline error, router.refresh after the WP flips to
// pending_approval. The submitWorkPackageForApproval action carries the
// role (SITE_STAFF_ROLES) + membership (RLS) gates. Shown by the page only when
// status is submittable (TRANSITIONABLE) and the viewer is not read-only.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { submitWorkPackageForApproval } from "./actions";

export function SubmitForApprovalControl({
  projectId,
  workPackageId,
}: {
  projectId: string;
  workPackageId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function handleSubmit() {
    if (submitting) return;
    setError(null);
    startSubmit(async () => {
      const result = await submitWorkPackageForApproval({ projectId, workPackageId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        ส่งงานเข้าตรวจ
      </button>

      <BottomSheet open={open} title="ส่งงานเข้าตรวจ" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-ink-secondary text-sm">
            ส่งงานนี้ให้ผู้จัดการตรวจ — สถานะจะเปลี่ยนเป็น “รออนุมัติ” ทำเมื่องานเสร็จทั้งหมดแล้ว
          </p>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังส่ง…" : "ส่งเข้าตรวจ"}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
